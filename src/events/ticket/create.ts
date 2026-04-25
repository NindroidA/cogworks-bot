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
  type StringSelectMenuInteraction,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
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
  LogCategory,
  lang,
  PermissionSets,
  RateLimits,
  rateLimiter,
} from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';
import { isLegacyTicketType, resolveLegacyPingColumn, resolveTicketType } from '../../utils/ticket/legacyTypes';
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

/** Build a legacy ticket modal with the correct inputs for the given type. */
function buildLegacyTicketModal(typeId: string, modal: ModalBuilder): ModalBuilder {
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

/** Build legacy ticket description from modal submit fields. */
function buildLegacyTicketDescription(typeId: string, fields: ModalSubmitFields): string {
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
    enhancedLogger.warn('Failed to load custom ticket types, using legacy options', LogCategory.COMMAND_EXECUTION, {
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
    await interaction.reply({
      content: '🚫 You are not allowed to create this type of ticket.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (isLegacyTicketType(selectedTypeId)) {
    enhancedLogger.debug(`Opening legacy modal for type: ${selectedTypeId}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      ticketType: selectedTypeId,
    });

    const modal = buildLegacyTicketModal(
      selectedTypeId,
      new ModalBuilder()
        .setCustomId(`ticket_modal_${selectedTypeId}`)
        .setTitle(`Create ${selectedTypeId.replace('_', ' ')} Ticket`),
    );

    await interaction.showModal(modal);
    return;
  }

  const ticketType = await customTypeRepo.findOne({ where: { guildId, typeId: selectedTypeId } });

  if (!ticketType) {
    await interaction.reply({
      content: '❌ Selected ticket type not found!',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${ticketType.typeId}`)
    .setTitle(`${ticketType.emoji || '🎫'} ${ticketType.displayName}`);

  if (ticketType.customFields && ticketType.customFields.length > 0) {
    const fieldsToAdd = ticketType.customFields.slice(0, 5);

    for (const field of fieldsToAdd) {
      const input = new TextInputBuilder()
        .setCustomId(field.id)
        .setLabel(field.label)
        .setStyle(field.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(field.required);

      if (field.placeholder) input.setPlaceholder(field.placeholder);
      if (field.minLength) input.setMinLength(field.minLength);
      if (field.maxLength) input.setMaxLength(field.maxLength);

      const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(actionRow);
    }
  } else {
    const descriptionInput = new TextInputBuilder()
      .setCustomId('ticket_description')
      .setLabel('Please describe your issue')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(ticketType.description || 'Provide details about your ticket...')
      .setRequired(true)
      .setMaxLength(2000);

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);
    modal.addComponents(actionRow);
  }

  await interaction.showModal(modal);

  setTimeout(async () => {
    try {
      await interaction.message.delete();
    } catch {
      // Silently fail - message might already be gone
    }
  }, 500);
};

export const legacyTicketTypeButton = async (_client: Client, interaction: ButtonInteraction) => {
  const ticketType = interaction.customId.replace('ticket_', '');

  // Filter — `ticket_*` matches non-legacy buttons too (e.g. `ticket_skip`)
  if (!isLegacyTicketType(ticketType)) return;

  enhancedLogger.debug(`Button: ticket_${ticketType}`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    ticketType,
  });

  const modal = buildLegacyTicketModal(
    ticketType,
    new ModalBuilder()
      .setCustomId(`ticket_modal_${ticketType}`)
      .setTitle(`Create ${ticketType.replace('_', ' ')} Ticket`),
  );

  await interaction.showModal(modal);
};

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
    await interaction.reply({
      content: lang.general.cmdGuildNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!category) {
    await interaction.reply({
      content: lang.ticket.ticketCategoryNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check rate limit (3 tickets per hour per user)
  const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'ticket-create');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.TICKET_CREATE);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: rateCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.warn(`User hit ticket creation rate limit`, LogCategory.SECURITY, {
      userId: interaction.user.id,
      guildId,
    });
    return;
  }

  try {
    const fields = interaction.fields;
    let description = '';

    const resolved = await resolveTicketType(guildId, ticketType);

    if (!resolved) {
      await interaction.reply({
        content: '❌ Ticket type configuration not found!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const isLegacyType = resolved.isLegacy;
    const displayName = resolved.displayName || ticketType;

    if (isLegacyType) {
      description = buildLegacyTicketDescription(ticketType, fields);
    } else {
      const customTypeConfig = resolved.customType;
      const header = `# ${displayName}\n`;

      if (customTypeConfig?.customFields && customTypeConfig.customFields.length > 0) {
        const fieldResponses: string[] = [];

        for (const field of customTypeConfig.customFields) {
          try {
            const value = fields.getTextInputValue(field.id);
            fieldResponses.push(`**${field.label}:** ${escapeDiscordMarkdown(value)}`);
          } catch {
            // Field may not be present in the modal submission — skip silently
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

    if (!isLegacyType) {
      ticketData.customTypeId = ticketType;
    }

    const newTicket = ticketRepo.create(ticketData);
    const savedTicket = (await ticketRepo.save(newTicket)) as Ticket;

    const sanitizedDisplayName = displayName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const sanitizedUsername = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const channelName = `${savedTicket.id}_${sanitizedDisplayName}_${sanitizedUsername}`.substring(0, 100);

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

    const permOverwrites = createPrivateChannelPermissions(
      guildId,
      [member.id],
      staffRoleIds,
      PermissionSets.TICKET_CREATOR,
    );

    const channel = await guild.channels.create({
      name: channelName,
      type: 0,
      parent: category,
      permissionOverwrites: permOverwrites,
    });

    await interaction.reply({
      content: `${lang.ticket.created}${channel}`,
      flags: [MessageFlags.Ephemeral],
    });

    const welcomeMsg = `<@${member.user.id}>\n\n${lang.ticket.welcomeMsg}`;
    const buttonOptions = new ActionRowBuilder<ButtonBuilder>().setComponents(
      new ButtonBuilder().setCustomId('admin_only_ticket').setLabel('Admin Only').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
    );
    const newChannel = channel as TextChannel;

    const welcome = await newChannel.send({
      content: welcomeMsg,
      components: [buttonOptions],
    });
    await newChannel.send(`​\n${description}`);

    const botConfig = await botConfigRepo.findOneBy({ guildId });
    if (botConfig?.enableGlobalStaffRole && botConfig?.globalStaffRole) {
      let shouldPingStaff = false;

      if (isLegacyType) {
        const pingColumn = resolveLegacyPingColumn(ticketType);
        if (pingColumn && modalTicketConfig) {
          shouldPingStaff = modalTicketConfig[pingColumn] as boolean;
        }
      } else {
        shouldPingStaff = resolved.customType?.pingStaffOnCreate ?? true;
      }

      if (shouldPingStaff) {
        await newChannel.send({
          content: `${botConfig.globalStaffRole}\n📨 A new **${displayName}** ticket has been created!`,
        });
      }
    }

    await ticketRepo.update(
      { id: savedTicket.id, guildId },
      {
        messageId: welcome.id,
        channelId: newChannel.id,
        status: 'opened',
      },
    );

    enhancedLogger.info(`Ticket created: #${savedTicket.id} (${ticketType})`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      ticketId: savedTicket.id,
      ticketType,
      channelId: newChannel.id,
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
      },
    );
    await interaction.reply({
      content: lang.ticket.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
