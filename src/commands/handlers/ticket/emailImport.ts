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
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import {
  enhancedLogger,
  extractIdFromMention,
  guardAdminRateLimit,
  handleInteractionError,
  LANGF,
  LogCategory,
  lang,
  maskEmail,
  RateLimits,
  validateSafeUrl,
} from '../../../utils';

const tl = lang.ticket.customTypes.emailImport;

/**
 * Handler for /ticket import-email command
 * Shows modal for importing an email as a ticket
 */
export async function emailImportHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Permission check — email import is an admin-level operation
    const guard = await guardAdminRateLimit(interaction, {
      action: 'email-import',
      limit: RateLimits.TICKET_CREATE,
      scope: 'user',
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
      .setMaxLength(256); // Discord channel topic max

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
    await interaction.reply({
      content: LANGF(tl.tooManyUrls, '10'),
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  for (const url of urls) {
    if (url.length > 500) {
      await interaction.reply({
        content: LANGF(tl.urlTooLong, '500'),
        flags: [MessageFlags.Ephemeral],
      });
      return null;
    }

    const urlError = validateSafeUrl(url);
    if (urlError) {
      await interaction.reply({
        content: LANGF(tl.invalidUrl, url),
        flags: [MessageFlags.Ephemeral],
      });
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
      isActive: true,
      isDefault: false,
      sortOrder: 999,
    });
    await typeRepo.save(emailType);
  }

  return emailType;
}

/** Build channel permission overwrites for the email ticket channel. */
function buildEmailTicketPermissions(guildId: string, botUserId: string, botConfig: BotConfig) {
  const permissionOverwrites = [
    {
      id: guildId,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: botUserId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ];

  if (botConfig.enableGlobalStaffRole && botConfig.globalStaffRole) {
    const staffRoleId = extractIdFromMention(botConfig.globalStaffRole);
    if (staffRoleId) {
      permissionOverwrites.push({
        id: staffRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      });
    }
  }

  return permissionOverwrites;
}

/** Build the email content embed and action buttons for the ticket channel. */
function buildEmailTicketEmbed(opts: {
  subject: string;
  body: string;
  senderName: string | null;
  senderEmail: string;
  userId: string;
  embedColor: string;
  attachmentUrls: string[];
}) {
  const embed = new EmbedBuilder()
    .setTitle(`📧 Email Import: ${opts.subject}`)
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
  if (opts.attachmentUrls.length > 0) {
    embed.addFields({
      name: 'Attachments',
      value: opts.attachmentUrls.map((url, i) => `[Attachment ${i + 1}](${url})`).join('\n'),
    });
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

  return { embed, buttonRow };
}

/**
 * Handler for ticket email import modal submission
 */
export async function emailImportModalHandler(interaction: ModalSubmitInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // Rate limit: shares TICKET_CREATE budget with manual ticket creation
    const guard = await guardAdminRateLimit(interaction, {
      action: 'ticket-create',
      limit: RateLimits.TICKET_CREATE,
      scope: 'user',
      skipAdmin: true,
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
      await interaction.reply({
        content: tl.invalidEmail,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (body.length > 4000) {
      await interaction.reply({
        content: LANGF(tl.bodyTooLong, '4000'),
        flags: [MessageFlags.Ephemeral],
      });
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
      await interaction.reply({
        content: lang.botConfig.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
    if (!ticketConfig || !ticketConfig.categoryId) {
      await interaction.reply({
        content: lang.ticket.ticketConfigNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Ensure email_import ticket type exists
    const emailType = await ensureEmailImportType(guildId);

    // Validate ticket category
    const category = await interaction.guild!.channels.fetch(ticketConfig.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      await interaction.reply({
        content: lang.ticket.ticketCategoryNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Build channel name from sender
    const nameForChannel = senderName || senderEmail.split('@')[0];
    const channelName = `📧_${nameForChannel
      .substring(0, 100)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')}`;

    try {
      // Create ticket channel
      const ticketChannel = await interaction.guild!.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: subject.substring(0, 256),
        permissionOverwrites: buildEmailTicketPermissions(guildId, interaction.client.user.id, botConfig),
      });

      // Send welcome embed with action buttons
      const { embed, buttonRow } = buildEmailTicketEmbed({
        subject,
        body,
        senderName,
        senderEmail,
        userId,
        embedColor: emailType.embedColor,
        attachmentUrls,
      });

      const welcomeMessage = await ticketChannel.send({
        embeds: [embed],
        components: [buttonRow],
      });

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
        content: LANGF(tl.success, ticketChannel.toString()),
        flags: [MessageFlags.Ephemeral],
      });
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        if (error.code === 50013) {
          enhancedLogger.warn('Email-import failed: missing permissions', LogCategory.COMMAND_EXECUTION, {
            userId,
            guildId,
            errorCode: error.code,
          });
          await interaction.reply({
            content: tl.permissionError,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        enhancedLogger.error('Email-import Discord API error', error, LogCategory.COMMAND_EXECUTION, {
          userId,
          guildId,
          errorCode: error.code,
        });
        await interaction.reply({
          content: LANGF(tl.apiError, error.message),
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      throw error;
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'emailImportModalHandler');
  }
}
