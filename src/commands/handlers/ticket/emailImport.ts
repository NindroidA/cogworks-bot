import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionsBitField,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { StaffRole } from '../../../typeorm/entities/StaffRole';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import {
  createPrivateChannelPermissions,
  enhancedLogger,
  extractIdFromMention,
  formatLang,
  guardFeatureRateLimit,
  handleInteractionError,
  LogCategory,
  lang,
  maskEmail,
  PermissionSets,
  RateLimits,
  replyEphemeralError,
  validateSafeUrl,
  verifiedChannelDelete,
} from '../../../utils';

const tl = lang.ticket.customTypes.emailImport;

/**
 * Handler for /ticket import-email command
 * Shows modal for importing an email as a ticket
 */
export async function emailImportHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Permission check — email import is an admin-level operation. The budget
    // is per user per server: staff in several servers don't share one.
    const guard = await guardFeatureRateLimit(interaction, 'tickets', 'manage', {
      action: 'email-import',
      limit: RateLimits.TICKET_CREATE,
      scope: 'userGuild',
    });
    if (!guard.allowed) return;

    enhancedLogger.debug(`Command: /ticket import-email`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId: interaction.guildId!,
    });

    // Create modal
    const modal = new ModalBuilder().setCustomId('ticket-email-import-modal').setTitle(tl.modalTitle);

    const senderEmailInput = new TextInputBuilder()
      .setCustomId('senderEmail')
      .setLabel(tl.senderEmailLabel)
      .setPlaceholder(tl.senderEmailPlaceholder)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(254); // RFC 5321 max email length

    const senderNameInput = new TextInputBuilder()
      .setCustomId('senderName')
      .setLabel(tl.senderNameLabel)
      .setPlaceholder(tl.senderNamePlaceholder)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);

    const subjectInput = new TextInputBuilder()
      .setCustomId('subject')
      .setLabel(tl.subjectLabel)
      .setPlaceholder(tl.subjectPlaceholder)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(255); // tickets.emailSubject is varchar(255)

    const bodyInput = new TextInputBuilder()
      .setCustomId('body')
      .setLabel(tl.bodyLabel)
      .setPlaceholder(tl.bodyPlaceholder)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000); // Discord modal max

    const attachmentsInput = new TextInputBuilder()
      .setCustomId('attachments')
      .setLabel(tl.attachmentsLabel)
      .setPlaceholder(tl.attachmentsPlaceholder)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(senderEmailInput);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(senderNameInput);
    const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput);
    const row4 = new ActionRowBuilder<TextInputBuilder>().addComponents(bodyInput);
    const row5 = new ActionRowBuilder<TextInputBuilder>().addComponents(attachmentsInput);

    modal.addComponents(row1, row2, row3, row4, row5);

    await interaction.showModal(modal);
  } catch (error) {
    await handleInteractionError(interaction, error, 'emailImportHandler');
  }
}

/** Parse and validate attachment URLs from the multi-line input. Returns null if validation fails (reply already sent). */
async function parseAttachmentUrls(
  interaction: ModalSubmitInteraction,
  attachmentsInput: string,
): Promise<string[] | null> {
  if (!attachmentsInput) return [];

  const urls = attachmentsInput
    .split('\n')
    .map(u => u.trim())
    .filter(u => u);

  if (urls.length > 10) {
    await replyEphemeralError(interaction, formatLang(tl.tooManyUrls, '10'));
    return null;
  }

  for (const url of urls) {
    if (url.length > 500) {
      await replyEphemeralError(interaction, formatLang(tl.urlTooLong, '500'));
      return null;
    }

    const urlCheck = validateSafeUrl(url);
    if (!urlCheck.valid) {
      await replyEphemeralError(interaction, formatLang(tl.invalidUrl, url));
      return null;
    }
  }

  return urls;
}

/** Ensure the email_import ticket type exists, creating it if needed. */
async function ensureEmailImportType(guildId: string) {
  const typeRepo = AppDataSource.getRepository(CustomTicketType);

  let emailType = await typeRepo.findOne({
    where: { guildId, typeId: 'email_import' },
  });

  if (!emailType) {
    emailType = typeRepo.create({
      guildId,
      typeId: 'email_import',
      displayName: 'Email Import',
      emoji: '📧',
      embedColor: '#7289da',
      description: 'Ticket imported from email',
      // Internal type: inactive so it never shows in the members' ticket menu
      // (the import path finds the row whatever its isActive).
      isActive: false,
      isDefault: false,
      sortOrder: 999,
    });
    await typeRepo.save(emailType);
  }

  return emailType;
}

/**
 * Build channel permission overwrites for the email ticket channel: the importer,
 * every saved staff/admin role (the same set /ticket create grants), the global
 * staff role when enabled, and the bot. Stored role refs may be raw IDs or legacy
 * `<@&id>` mentions; roles missing from `existingRoles` are skipped. Exported for tests.
 */
export function buildEmailTicketPermissions(opts: {
  guildId: string;
  importerId: string;
  botUserId: string;
  botConfig: BotConfig;
  staffRoleRefs: string[];
  existingRoles: { has(roleId: string): boolean };
}) {
  const { botConfig } = opts;
  const roleRefs = [...opts.staffRoleRefs];
  if (botConfig.enableGlobalStaffRole && botConfig.globalStaffRole) roleRefs.push(botConfig.globalStaffRole);
  const roleIds = roleRefs.map(ref => extractIdFromMention(ref)).filter((id): id is string => id !== null);

  const permissionOverwrites = createPrivateChannelPermissions(
    opts.guildId,
    [opts.importerId],
    roleIds,
    PermissionSets.STAFF_MEMBER,
    opts.existingRoles,
  );
  permissionOverwrites.push({
    id: opts.botUserId,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ReadMessageHistory,
    ],
  });

  return permissionOverwrites;
}

/** Cut text to at most `max` UTF-16 units (what discord.js checks) without splitting a surrogate pair. */
function clampEmbedText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/** Discord limits: field value 1,024 characters, message content 2,000. */
const FIELD_VALUE_MAX = 1024;
const MESSAGE_MAX = 2000;

/**
 * Build the email content embed and action buttons for the ticket channel.
 * Attachment links go in an embed field when they fit in one; otherwise they
 * come back as `attachmentMessages` (each under 2,000 characters) to post
 * after the embed, so long pre-signed URLs never break the embed. Exported
 * for tests.
 */
export function buildEmailTicketEmbed(opts: {
  subject: string;
  body: string;
  senderName: string | null;
  senderEmail: string;
  userId: string;
  embedColor: string;
  attachmentUrls: string[];
}) {
  const embed = new EmbedBuilder()
    .setTitle(clampEmbedText(`📧 Email Import: ${opts.subject}`, 256))
    .setColor(opts.embedColor as `#${string}`)
    .setDescription(opts.body.substring(0, 4096))
    .addFields(
      {
        name: 'From',
        value: opts.senderName || opts.senderEmail.split('@')[0],
        inline: true,
      },
      {
        name: 'Imported By',
        value: `<@${opts.userId}>`,
        inline: true,
      },
    );
  const links = opts.attachmentUrls.map((url, i) => `[Attachment ${i + 1}](${url})`);
  const attachmentMessages: string[] = [];
  if (links.join('\n').length <= FIELD_VALUE_MAX) {
    if (links.length > 0) embed.addFields({ name: 'Attachments', value: links.join('\n') });
  } else {
    // Each link is under 520 characters (URLs are capped at 500)
    for (const link of links) {
      const last = attachmentMessages.length - 1;
      if (last >= 0 && attachmentMessages[last].length + 1 + link.length <= MESSAGE_MAX) {
        attachmentMessages[last] += `\n${link}`;
      } else {
        attachmentMessages.push(link);
      }
    }
  }

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().setComponents(
    new ButtonBuilder()
      .setCustomId('admin_only_ticket')
      .setLabel(lang.general.buttons.adminOnly)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel(lang.general.buttons.closeTicket)
      .setStyle(ButtonStyle.Danger),
  );

  return { embed, buttonRow, attachmentMessages };
}

/**
 * Handler for ticket email import modal submission
 */
export async function emailImportModalHandler(interaction: ModalSubmitInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // Permission re-checked on submit (defense in depth), then the rate limit,
    // which shares the per-server TICKET_CREATE budget with manual ticket creation.
    const guard = await guardFeatureRateLimit(interaction, 'tickets', 'manage', {
      action: 'ticket-create',
      limit: RateLimits.TICKET_CREATE,
      scope: 'userGuild',
    });
    if (!guard.allowed) return;

    enhancedLogger.debug(`Modal submit: email-import`, LogCategory.COMMAND_EXECUTION, {
      userId,
      guildId,
    });

    // Get modal inputs
    const senderEmail = interaction.fields.getTextInputValue('senderEmail').trim();
    const senderName = interaction.fields.getTextInputValue('senderName')?.trim() || null;
    const subject = interaction.fields.getTextInputValue('subject').trim();
    const body = interaction.fields.getTextInputValue('body').trim();
    const attachmentsInput = interaction.fields.getTextInputValue('attachments')?.trim() || '';

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(senderEmail)) {
      enhancedLogger.warn(
        `Email-import validation failed: invalid email '${maskEmail(senderEmail)}'`,
        LogCategory.COMMAND_EXECUTION,
        { userId, guildId },
      );
      await replyEphemeralError(interaction, tl.invalidEmail);
      return;
    }

    if (body.length > 4000) {
      await replyEphemeralError(interaction, formatLang(tl.bodyTooLong, '4000'));
      return;
    }

    // Parse and validate attachment URLs
    const attachmentUrls = await parseAttachmentUrls(interaction, attachmentsInput);
    if (attachmentUrls === null) return;

    // Load configs
    const botConfigRepo = AppDataSource.getRepository(BotConfig);
    const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);

    const botConfig = await botConfigRepo.findOneBy({ guildId });
    if (!botConfig) {
      await replyEphemeralError(interaction, lang.botConfig.notFound);
      return;
    }

    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
    if (!ticketConfig?.categoryId) {
      await replyEphemeralError(interaction, lang.ticket.ticketConfigNotFound);
      return;
    }

    // Ensure email_import ticket type exists
    const emailType = await ensureEmailImportType(guildId);

    // Validate ticket category
    const category = await interaction.guild!.channels.fetch(ticketConfig.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      await replyEphemeralError(interaction, lang.ticket.ticketCategoryNotFound);
      return;
    }

    // Build channel name from sender
    const nameForChannel = senderName || senderEmail.split('@')[0];
    const channelName = `📧_${nameForChannel
      .substring(0, 100)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')}`;

    const staffRoles = await AppDataSource.getRepository(StaffRole).find({ where: { guildId } });

    // Built before the channel exists so a builder error can't leave one behind
    const { embed, buttonRow, attachmentMessages } = buildEmailTicketEmbed({
      subject,
      body,
      senderName,
      senderEmail,
      userId,
      embedColor: emailType.embedColor,
      attachmentUrls,
    });

    let ticketChannel: TextChannel | undefined;
    let ticketSaved = false;
    try {
      // Create ticket channel
      ticketChannel = await interaction.guild!.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: subject.substring(0, 256),
        permissionOverwrites: buildEmailTicketPermissions({
          guildId,
          importerId: userId,
          botUserId: interaction.client.user.id,
          botConfig,
          staffRoleRefs: staffRoles.map(r => r.role),
          existingRoles: interaction.guild!.roles.cache,
        }),
      });

      const welcomeMessage = await ticketChannel.send({
        embeds: [embed],
        components: [buttonRow],
      });
      for (const content of attachmentMessages) await ticketChannel.send({ content });

      // Save ticket to database
      const ticketRepo = AppDataSource.getRepository(Ticket);
      const ticket = ticketRepo.create({
        guildId,
        channelId: ticketChannel.id,
        messageId: welcomeMessage.id,
        createdBy: userId,
        type: 'email_import',
        customTypeId: 'email_import',
        isEmailTicket: true,
        emailSender: senderEmail,
        emailSenderName: senderName || undefined,
        emailSubject: subject,
        status: 'created',
      });

      await ticketRepo.save(ticket);
      ticketSaved = true;

      enhancedLogger.info(
        `Email ticket imported: #${ticket.id} from ${maskEmail(senderEmail)}`,
        LogCategory.COMMAND_EXECUTION,
        {
          userId,
          guildId,
          ticketId: ticket.id,
          senderEmail: maskEmail(senderEmail),
          channelId: ticketChannel.id,
        },
      );

      await interaction.reply({
        content: formatLang(tl.success, ticketChannel.toString()),
        flags: [MessageFlags.Ephemeral],
      });
    } catch (error) {
      // No ticket row: the channel would have no working Close button, so remove it
      if (ticketChannel && !ticketSaved) {
        await verifiedChannelDelete(ticketChannel, { guildId, label: 'unfinished email-import channel' });
      }
      if (error instanceof DiscordAPIError) {
        if (error.code === 50013) {
          enhancedLogger.warn('Email-import failed: missing permissions', LogCategory.COMMAND_EXECUTION, {
            userId,
            guildId,
            errorCode: error.code,
          });
          await replyEphemeralError(interaction, tl.permissionError);
          return;
        }

        enhancedLogger.error('Email-import Discord API error', error, LogCategory.COMMAND_EXECUTION, {
          userId,
          guildId,
          errorCode: error.code,
        });
        await replyEphemeralError(interaction, formatLang(tl.apiError, error.message));
        return;
      }
      throw error;
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'emailImportModalHandler');
  }
}

/**
 * Untouched alias for suites that test the REAL handler (same pattern as
 * ticketAdminOnlyEventImpl): ticketInteraction.test.ts mock.module()s this
 * module process-globally and spreads the real exports, so this passes through.
 */
export const emailImportModalHandlerImpl = emailImportModalHandler;
