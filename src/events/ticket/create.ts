import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  type GuildMember,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitFields,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  roleMention,
  type StringSelectMenuInteraction,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
  userMention,
} from 'discord.js';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { StaffRole } from '../../typeorm/entities/StaffRole';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { UserTicketRestriction } from '../../typeorm/entities/ticket/UserTicketRestriction';
import {
  createPrivateChannelPermissions,
  createRateLimitKey,
  enhancedLogger,
  escapeDiscordMarkdown,
  extractIdFromMention,
  formatLang,
  LogCategory,
  lang,
  PermissionSets,
  RateLimits,
  rateLimiter,
  replyEphemeralError,
  TEXT_LIMITS,
  verifiedChannelDelete,
} from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';
import { isBuiltinTicketType, resolveBuiltinPingColumn, resolveTicketType } from '../../utils/ticket/builtinTypes';
import { pickTicketAssignee } from '../../utils/ticket/smartRouter';
import { chunkByMessageBoundary } from '../../utils/ticket/transcriptBuilder';
import { ageVerifyMessage, ageVerifyModal } from './ageVerify';
import { banAppealMessage, banAppealModal } from './banAppeal';
import { bugReportMessage, bugReportModal } from './bugReport';
import { customTicketOptions, ticketOptions } from './index';
import { otherMessage, otherModal } from './other';
import { playerReportMessage, playerReportModal } from './playerReport';

const ticketConfigRepo = lazyRepo(TicketConfig);
const ticketRepo = lazyRepo(Ticket);
const staffRoleRepo = lazyRepo(StaffRole);
const botConfigRepo = lazyRepo(BotConfig);
const customTypeRepo = lazyRepo(CustomTicketType);
const restrictionRepo = lazyRepo(UserTicketRestriction);

/** Discord's modal limits: title and input label 45, placeholder 100 (UTF-16 units). */
const MODAL_TITLE_MAX = 45;
const INPUT_LABEL_MAX = 45;
const INPUT_PLACEHOLDER_MAX = 100;
const TYPE_NOT_ALLOWED = '🚫 You are not allowed to create this type of ticket.';
/** The bot's own overwrite on a ticket channel (same set email import grants). */
const BOT_TICKET_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
];

/** Clamp text to a Discord length limit without splitting an emoji or other surrogate pair. */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const char of text) {
    if (out.length + char.length > max - 1) break;
    out += char;
  }
  return `${out}…`;
}

/** True when the user may not open this type: a restriction, or a deactivated custom type. */
async function isTypeBlocked(
  guildId: string,
  userId: string,
  typeId: string,
  customType: CustomTicketType | null,
): Promise<boolean> {
  if (customType?.isActive === false) return true;
  const restriction = await restrictionRepo.findOne({ where: { guildId, userId, typeId } });
  return !!restriction;
}

/** Build a builtin ticket modal with the correct inputs for the given type. */
function buildBuiltinTicketModal(typeId: string, modal: ModalBuilder): ModalBuilder {
  switch (typeId) {
    case '18_verify':
      return ageVerifyModal(modal);
    case 'ban_appeal':
      return banAppealModal(modal);
    case 'player_report':
      return playerReportModal(modal);
    case 'bug_report':
      return bugReportModal(modal);
    case 'other':
      return otherModal(modal);
    default:
      return modal;
  }
}

/**
 * Build a ticket modal from a CustomTicketType row's customFields.
 *
 * Used by both the select-menu and button entry points so they show the
 * exact same field set the submit handler will read back via
 * `resolveTicketType()` → `customType.customFields`. Without this, the
 * 5 builtin typeIds (which `ensureDefaultTicketTypes` seeds as custom
 * rows on every guild) would be shown the hardcoded builtin modal whose
 * field IDs don't match the seeded customFields — producing tickets with
 * just a heading and no body. (Prod incident 2026-05-05, ticket #112.)
 */
export function buildCustomTicketModal(ticketType: CustomTicketType): ModalBuilder {
  // Modal titles are plain text, so a `<:name:id>` custom emoji would show raw.
  const emoji = ticketType.emoji && !ticketType.emoji.startsWith('<') ? ticketType.emoji : '🎫';
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${ticketType.typeId}`)
    .setTitle(clampText(`${emoji} ${ticketType.displayName}`, MODAL_TITLE_MAX));

  if (ticketType.customFields && ticketType.customFields.length > 0) {
    // Discord caps modals at 5 components — same cap honored by the prior inline path
    const fieldsToAdd = ticketType.customFields.slice(0, 5);

    for (const field of fieldsToAdd) {
      const input = new TextInputBuilder()
        .setCustomId(field.id)
        .setLabel(clampText(field.label, INPUT_LABEL_MAX))
        .setStyle(field.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(field.required);

      // Stored lengths are only checked one at a time; Discord rejects the
      // modal when they fall outside 0-4000 or min > max.
      const maxLength = field.maxLength ? Math.min(Math.max(field.maxLength, 1), TEXT_LIMITS.PARAGRAPH_FIELD) : 0;
      const minLength = Math.min(Math.max(field.minLength ?? 0, 0), maxLength || TEXT_LIMITS.PARAGRAPH_FIELD);
      if (field.placeholder) input.setPlaceholder(clampText(field.placeholder, INPUT_PLACEHOLDER_MAX));
      if (minLength) input.setMinLength(minLength);
      if (maxLength) input.setMaxLength(maxLength);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }
  } else {
    const descriptionInput = new TextInputBuilder()
      .setCustomId('ticket_description')
      .setLabel(lang.ticket.createModal.descriptionLabel)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(
        clampText(ticketType.description || lang.ticket.createModal.descriptionPlaceholder, INPUT_PLACEHOLDER_MAX),
      )
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput));
  }

  return modal;
}

/** Build builtin ticket description from modal submit fields. */
function buildBuiltinTicketDescription(typeId: string, fields: ModalSubmitFields): string {
  switch (typeId) {
    case '18_verify':
      return ageVerifyMessage(fields);
    case 'ban_appeal':
      return banAppealMessage(fields);
    case 'player_report':
      return playerReportMessage(fields);
    case 'bug_report':
      return bugReportMessage(fields);
    case 'other':
      return otherMessage(fields);
    default:
      return '';
  }
}

export const createTicketButton = async (_client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  enhancedLogger.debug(`Button: create_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
  });

  const config = await ticketConfigRepo.findOneBy({ guildId });
  if (!config) {
    enhancedLogger.warn('Create ticket failed: ticketConfig not found', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });
    return;
  }

  if (config.messageId !== interaction.message.id) return;

  try {
    const customOptions = await customTicketOptions(guildId, interaction.user.id);
    await interaction.reply({
      content: lang.ticket.selectTicketType,
      components: [customOptions],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.warn('Failed to load custom ticket types, using builtin options', LogCategory.COMMAND_EXECUTION, {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
    const options = ticketOptions();
    await interaction.reply({
      content: lang.ticket.selectTicketType,
      components: [options],
      flags: [MessageFlags.Ephemeral],
    });
  }
};

export const cancelTicketButton = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: cancel_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: lang.ticket.cancelled, components: [] });
};

export const selectTicketType = async (_client: Client, interaction: StringSelectMenuInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const selectedTypeId = interaction.values[0];
  enhancedLogger.debug(`Select: ticket type '${selectedTypeId}'`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    selectedTypeId,
  });

  if (selectedTypeId === 'none') {
    await interaction.reply({
      content: '🚫 You do not have access to create any ticket types.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const restriction = await restrictionRepo.findOne({
    where: { guildId, userId: interaction.user.id, typeId: selectedTypeId },
  });

  if (restriction) {
    await interaction.reply({ content: TYPE_NOT_ALLOWED, flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Custom-type-first lookup: covers the 5 builtin IDs that
  // `ensureDefaultTicketTypes` seeds as CustomTicketType rows on every
  // guild. Falling back to the hardcoded builtin modal when no custom row
  // exists keeps cold-start guilds (predating the seeder) working.
  const ticketType = await customTypeRepo.findOne({
    where: { guildId, typeId: selectedTypeId },
  });

  if (ticketType) {
    enhancedLogger.debug('Opening custom-type modal', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      ticketType: selectedTypeId,
    });
    await interaction.showModal(buildCustomTicketModal(ticketType));

    setTimeout(async () => {
      try {
        await interaction.message.delete();
      } catch {
        // Silently fail - message might already be gone
      }
    }, 500);
    return;
  }

  if (isBuiltinTicketType(selectedTypeId)) {
    enhancedLogger.debug('Opening builtin modal (no custom-type row found)', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      ticketType: selectedTypeId,
    });

    const modal = buildBuiltinTicketModal(
      selectedTypeId,
      new ModalBuilder()
        .setCustomId(`ticket_modal_${selectedTypeId}`)
        .setTitle(`Create ${selectedTypeId.replace('_', ' ')} Ticket`),
    );

    await interaction.showModal(modal);
    return;
  }

  await interaction.reply({
    content: '❌ Selected ticket type not found!',
    flags: [MessageFlags.Ephemeral],
  });
};

export const builtinTicketTypeButton = async (_client: Client, interaction: ButtonInteraction) => {
  const ticketType = interaction.customId.replace('ticket_', '');

  // Filter — `ticket_*` matches non-builtin buttons too (e.g. `ticket_skip`)
  if (!isBuiltinTicketType(ticketType)) return;

  enhancedLogger.debug(`Button: ticket_${ticketType}`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    ticketType,
  });

  // Mirror selectTicketType: prefer the seeded CustomTicketType row over the
  // hardcoded builtin modal so the modal fields match what submitTicketModal
  // (via resolveTicketType) expects to read back. (Prod 2026-05-05.)
  const guildId = interaction.guildId;
  if (guildId) {
    const customType = await customTypeRepo.findOne({
      where: { guildId, typeId: ticketType },
    });
    // The legacy buttons are a fallback for the menu, which hides restricted
    // and inactive types; apply the same rules here.
    if (await isTypeBlocked(guildId, interaction.user.id, ticketType, customType)) {
      await interaction.reply({ content: TYPE_NOT_ALLOWED, flags: [MessageFlags.Ephemeral] });
      return;
    }
    if (customType) {
      await interaction.showModal(buildCustomTicketModal(customType));
      return;
    }
  }

  const modal = buildBuiltinTicketModal(
    ticketType,
    new ModalBuilder()
      .setCustomId(`ticket_modal_${ticketType}`)
      .setTitle(`Create ${ticketType.replace('_', ' ')} Ticket`),
  );

  await interaction.showModal(modal);
};

/**
 * Undo a ticket whose setup failed before its welcome message went out:
 * delete the channel first (Discord-first), then the row, so no orphan channel
 * or channel-less 'created' row is left. If the channel can't be deleted, its
 * row stays so staff can still close it.
 */
async function rollbackFailedTicket(guildId: string, ticket: Ticket | null, channel: TextChannel | null) {
  try {
    if (channel) {
      const result = await verifiedChannelDelete(channel, { guildId, label: 'ticket channel' });
      if (!result.success) return;
    }
    if (ticket) await ticketRepo.delete({ id: ticket.id, guildId });
  } catch (error) {
    enhancedLogger.error(
      'Failed to roll back a half-created ticket',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.DATABASE,
      { guildId, ticketId: ticket?.id, channelId: channel?.id },
    );
  }
}

export const submitTicketModal = async (_client: Client, interaction: ModalSubmitInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const ticketType = interaction.customId.replace('ticket_modal_', '');
  const member = interaction.member as GuildMember;
  const guild = interaction.guild;
  const modalTicketConfig = await ticketConfigRepo.findOneBy({ guildId });
  const category = modalTicketConfig?.categoryId;

  enhancedLogger.debug(`Modal submit: ticket_modal_${ticketType}`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    ticketType,
  });

  if (!guild) {
    await replyEphemeralError(interaction, lang.general.cmdGuildNotFound);
    return;
  }

  if (!category) {
    await replyEphemeralError(interaction, lang.ticket.ticketCategoryNotFound);
    return;
  }

  let savedTicket: Ticket | null = null;
  let newChannel: TextChannel | null = null;
  let welcomeSent = false;

  try {
    // Routing, the DB writes and channels.create can outlast Discord's
    // 3-second reply window, so acknowledge first.
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const fields = interaction.fields;
    let description = '';

    const resolved = await resolveTicketType(guildId, ticketType);

    if (!resolved) {
      await interaction.editReply({ content: '❌ Ticket type configuration not found!' });
      return;
    }

    // Every entry path (menu, legacy buttons, a modal left open) ends here.
    if (await isTypeBlocked(guildId, interaction.user.id, ticketType, resolved.customType)) {
      await interaction.editReply({ content: TYPE_NOT_ALLOWED });
      return;
    }

    // 3 tickets per hour per user in each server: a busy server must not use
    // up the user's budget everywhere else.
    const rateLimitKey = createRateLimitKey.userGuild(interaction.user.id, guildId, 'ticket-create');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.TICKET_CREATE);

    if (!rateCheck.allowed) {
      await interaction.editReply({ content: rateCheck.message ?? lang.ticket.error });
      enhancedLogger.warn(`User hit ticket creation rate limit`, LogCategory.SECURITY, {
        userId: interaction.user.id,
        guildId,
      });
      return;
    }

    const isBuiltinType = resolved.isBuiltin;
    const displayName = resolved.displayName || ticketType;

    if (isBuiltinType) {
      description = buildBuiltinTicketDescription(ticketType, fields);
    } else {
      const customTypeConfig = resolved.customType;
      const header = `# ${displayName}\n`;

      if (customTypeConfig?.customFields && customTypeConfig.customFields.length > 0) {
        const fieldResponses: string[] = [];

        for (const field of customTypeConfig.customFields) {
          try {
            const value = fields.getTextInputValue(field.id);
            fieldResponses.push(`**${field.label}:** ${escapeDiscordMarkdown(value)}`);
          } catch (error) {
            // Field id missing from submission. With the modal-show path
            // fixed (custom-type-first), this should be unreachable; if it
            // fires we want to know loudly instead of producing a heading-
            // only ticket. (Prod 2026-05-05 ticket #112.)
            enhancedLogger.warn(
              `Custom field '${field.id}' missing from modal submission for type '${ticketType}'`,
              LogCategory.COMMAND_EXECUTION,
              {
                userId: interaction.user.id,
                guildId,
                ticketType,
                fieldId: field.id,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }

        description = header + fieldResponses.join('\n');
      } else {
        const defaultValue = fields.getTextInputValue('ticket_description');
        description = header + defaultValue;
      }
    }

    const ticketData: Partial<Ticket> = {
      guildId,
      createdBy: interaction.user.id,
      type: ticketType,
    };

    if (!isBuiltinType) {
      ticketData.customTypeId = ticketType;
    }

    // The row comes first because the channel name carries its id; every
    // failure below rolls it back (see rollbackFailedTicket).
    const newTicket = ticketRepo.create(ticketData);
    savedTicket = (await ticketRepo.save(newTicket)) as Ticket;
    const ticketId = savedTicket.id;

    const sanitizedDisplayName = displayName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const sanitizedUsername = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const channelName = `${ticketId}_${sanitizedDisplayName}_${sanitizedUsername}`.substring(0, 100);

    const rolePerms = await staffRoleRepo
      .createQueryBuilder()
      .select(['type', 'role'])
      .where('guildId = :guildId', { guildId })
      .getRawMany();

    const staffRoleIds = rolePerms
      .map(role => extractIdFromMention(role.role))
      .filter((id): id is string => {
        if (!id) {
          enhancedLogger.warn(`Invalid role format encountered`, LogCategory.COMMAND_EXECUTION, { guildId });
          return false;
        }
        return true;
      });

    // Smart routing (best effort: null on any failure or when it's off).
    const assignee = modalTicketConfig
      ? await pickTicketAssignee(guild, ticketType, modalTicketConfig, member.id)
      : null;

    const permOverwrites = createPrivateChannelPermissions(
      guildId,
      [member.id],
      staffRoleIds,
      PermissionSets.TICKET_CREATOR,
      guild.roles.cache,
    );
    // Without Administrator the @everyone deny would lock the bot out of the
    // channel it creates, so the welcome send and transcripts would fail.
    permOverwrites.push({ id: interaction.client.user.id, allow: BOT_TICKET_PERMISSIONS });
    if (assignee) permOverwrites.push({ id: assignee.id, allow: PermissionSets.STAFF_MEMBER });

    const channel = await guild.channels.create({
      name: channelName,
      type: 0,
      parent: category,
      permissionOverwrites: permOverwrites,
    });
    newChannel = channel as TextChannel;

    // Link the channel right away so any later failure still leaves a ticket
    // whose Close button works.
    await ticketRepo.update({ id: ticketId, guildId }, { channelId: newChannel.id });

    const welcomeMsg = `<@${member.user.id}>\n\n${lang.ticket.welcomeMsg}`;
    const buttonOptions = new ActionRowBuilder<ButtonBuilder>().setComponents(
      new ButtonBuilder()
        .setCustomId('admin_only_ticket')
        .setLabel(lang.ticket.buttons.adminOnly)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel(lang.ticket.buttons.closeTicket)
        .setStyle(ButtonStyle.Danger),
    );

    const welcome = await newChannel.send({
      content: welcomeMsg,
      components: [buttonOptions],
      allowedMentions: { users: [member.user.id] },
    });
    welcomeSent = true;

    // Discord caps message content at 2000 chars. The assembled answers can
    // exceed that (custom fields without a maxLength default to 4000 chars,
    // markdown escaping inflates length, builtin types add labels), which
    // previously threw and left the ticket with only a welcome message and no
    // answers — looking exactly like a blank submission. Chunk on line
    // boundaries so every answer always posts, no matter the length.
    // The answers are the opener's own text: they must never ping anyone.
    const answerChunks = chunkByMessageBoundary([`​\n${description}`]);
    for (const chunk of answerChunks) {
      await newChannel.send({ content: chunk, allowedMentions: { parse: [] } });
    }

    const botConfig = await botConfigRepo.findOneBy({ guildId });
    const globalStaffRoleId = botConfig?.enableGlobalStaffRole
      ? extractIdFromMention(botConfig.globalStaffRole ?? '')
      : null;
    if (globalStaffRoleId) {
      let shouldPingStaff = false;

      if (isBuiltinType) {
        const pingColumn = resolveBuiltinPingColumn(ticketType);
        if (pingColumn && modalTicketConfig) {
          shouldPingStaff = modalTicketConfig[pingColumn] as boolean;
        }
      } else {
        shouldPingStaff = resolved.customType?.pingStaffOnCreate ?? true;
      }

      if (shouldPingStaff) {
        await newChannel.send({
          content: `${roleMention(globalStaffRoleId)}\n📨 A new **${displayName}** ticket has been created!`,
          allowedMentions: { roles: [globalStaffRoleId] },
        });
      }
    }

    await ticketRepo.update(
      { id: ticketId, guildId },
      {
        messageId: welcome.id,
        status: 'opened',
        ...(assignee ? { assignedTo: assignee.id, assignedAt: new Date() } : {}),
      },
    );

    if (assignee) {
      await newChannel.send({
        content: formatLang(lang.ticket.routing.autoAssigned, userMention(assignee.id)),
        allowedMentions: { users: [assignee.id] },
      });
    }

    await interaction.editReply({ content: `${lang.ticket.created}${newChannel}` });

    enhancedLogger.info(`Ticket created: #${ticketId} (${ticketType})`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      ticketId,
      ticketType,
      channelId: newChannel.id,
      assignedTo: assignee?.id,
    });
  } catch (error) {
    enhancedLogger.error(
      'Failed to create ticket',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        ticketType,
        ticketId: savedTicket?.id,
        channelId: newChannel?.id,
      },
    );
    if (welcomeSent && newChannel) {
      // The channel is linked and has its Close button; only a later step
      // (answers, staff ping, final update) failed, so point the user at it.
      await interaction.editReply({ content: `${lang.ticket.created}${newChannel}` }).catch(() => {});
      return;
    }
    await rollbackFailedTicket(guildId, savedTicket, newChannel);
    await replyEphemeralError(interaction, lang.ticket.error);
  }
};
