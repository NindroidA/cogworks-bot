import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type GuildMember,
  type Interaction,
  MessageFlags,
  ModalBuilder,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { emailImportModalHandler } from '../commands/handlers/ticket/emailImport';
import { typeAddModalHandler } from '../commands/handlers/ticket/typeAdd';
import { typeEditModalHandler } from '../commands/handlers/ticket/typeEdit';
import { AppDataSource } from '../typeorm';
import { BotConfig } from '../typeorm/entities/BotConfig';
import { SavedRole } from '../typeorm/entities/SavedRole';
import { CustomTicketType } from '../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../typeorm/entities/ticket/TicketConfig';
import { UserTicketRestriction } from '../typeorm/entities/ticket/UserTicketRestriction';
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
} from '../utils';
import { customTicketOptions, ticketOptions } from './ticket';
import { ticketAdminOnlyEvent } from './ticket/adminOnly';
import { ageVerifyMessage, ageVerifyModal } from './ticket/ageVerify';
import { banAppealMessage, banAppealModal } from './ticket/banAppeal';
import { bugReportMessage, bugReportModal } from './ticket/bugReport';
import { ticketCloseEvent } from './ticket/close';
import { otherMessage, otherModal } from './ticket/other';
import { playerReportMessage, playerReportModal } from './ticket/playerReport';

const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
const ticketRepo = AppDataSource.getRepository(Ticket);
const savedRoleRepo = AppDataSource.getRepository(SavedRole);
const botConfigRepo = AppDataSource.getRepository(BotConfig);
const customTypeRepo = AppDataSource.getRepository(CustomTicketType);

// Legacy type column mapping for ping-on-create setting
type LegacyType = '18_verify' | 'ban_appeal' | 'player_report' | 'bug_report' | 'other';
const LEGACY_PING_COLUMNS: Record<LegacyType, keyof TicketConfig> = {
  '18_verify': 'pingStaffOn18Verify',
  ban_appeal: 'pingStaffOnBanAppeal',
  player_report: 'pingStaffOnPlayerReport',
  bug_report: 'pingStaffOnBugReport',
  other: 'pingStaffOnOther',
};

export const handleTicketInteraction = async (client: Client, interaction: Interaction) => {
  const guildId = interaction.guildId || '';
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

  /* Handle Custom Ticket Type Modals */
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'ticket-type-add-modal') {
      await typeAddModalHandler(interaction);
      return;
    }

    if (interaction.customId.startsWith('ticket-type-edit-modal:')) {
      const typeId = interaction.customId.replace('ticket-type-edit-modal:', '');
      await typeEditModalHandler(interaction, typeId);
      return;
    }

    if (interaction.customId === 'ticket-email-import-modal') {
      await emailImportModalHandler(interaction);
      return;
    }
  }

  /* Handle Ticket Type Ping Toggle Button */
  if (interaction.isButton() && interaction.customId.startsWith('ticket_type_ping_toggle:')) {
    const typeId = interaction.customId.replace('ticket_type_ping_toggle:', '');
    enhancedLogger.debug(
      `Button: staff ping toggle for type '${typeId}'`,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, typeId },
    );

    if (!guildId) {
      enhancedLogger.warn(
        'Staff ping toggle failed: guild not found',
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id },
      );
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const type = await customTypeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!type) {
      enhancedLogger.warn(
        `Staff ping toggle failed: type '${typeId}' not found`,
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId, typeId },
      );
      await interaction.reply({
        content: lang.ticket.customTypes.typeEdit.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Toggle the ping setting
    const previousState = type.pingStaffOnCreate;
    type.pingStaffOnCreate = !type.pingStaffOnCreate;
    await customTypeRepo.save(type);
    enhancedLogger.info(
      `Staff ping toggled for type '${typeId}': ${previousState} → ${type.pingStaffOnCreate}`,
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        typeId,
        previousState,
        newState: type.pingStaffOnCreate,
      },
    );

    // Import the embed builder and rebuild the embed with updated state
    const { buildTypeConfirmationEmbed } = await import('../commands/handlers/ticket/typeAdd');
    const embed = buildTypeConfirmationEmbed(type, false);

    // Update the button to reflect the new state
    const tl = lang.ticket.customTypes.typeAdd;
    const toggleButton = new ButtonBuilder()
      .setCustomId(`ticket_type_ping_toggle:${typeId}`)
      .setLabel(type.pingStaffOnCreate ? tl.pingToggleDisable : tl.pingToggleEnable)
      .setStyle(type.pingStaffOnCreate ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(type.pingStaffOnCreate ? '🔕' : '🔔');

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(toggleButton);

    // Update the message with the new embed and button state
    await interaction.update({
      embeds: [embed],
      components: [buttonRow],
    });

    return;
  }

  /* Create Ticket Button */
  if (interaction.isButton() && interaction.customId === 'create_ticket') {
    enhancedLogger.debug(`Button: create_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });

    // check if the ticket config exists
    if (!ticketConfig) {
      enhancedLogger.warn(
        'Create ticket failed: ticketConfig not found',
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      return;
    }

    // check if we have the right messageid
    if (ticketConfig.messageId === interaction.message.id) {
      try {
        // Try to get custom ticket types (filtered by user restrictions)
        const customOptions = await customTicketOptions(guildId, interaction.user.id);
        await interaction.reply({
          content: lang.ticket.selectTicketType,
          components: [customOptions],
          flags: [MessageFlags.Ephemeral],
        });
      } catch (error) {
        // Fallback to legacy buttons if custom types fail
        enhancedLogger.warn(
          'Failed to load custom ticket types, using legacy options',
          LogCategory.COMMAND_EXECUTION,
          {
            guildId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        const options = ticketOptions();
        await interaction.reply({
          content: lang.ticket.selectTicketType,
          components: [options],
          flags: [MessageFlags.Ephemeral],
        });
      }
    }
  }

  /* Cancel Ticket Button */
  if (interaction.isButton() && interaction.customId === 'cancel_ticket') {
    enhancedLogger.debug(`Button: cancel_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });

    // Update the message to remove components and show cancellation
    await interaction.update({
      content: lang.ticket.cancelled,
      components: [],
    });
  }

  /* Custom Ticket Type Select Menu */
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_select') {
    const selectedTypeId = interaction.values[0];
    enhancedLogger.debug(`Select: ticket type '${selectedTypeId}'`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      selectedTypeId,
    });

    // Handle "none" option (user has no available ticket types)
    if (selectedTypeId === 'none') {
      await interaction.reply({
        content: '🚫 You do not have access to create any ticket types.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check if user is restricted from creating this ticket type
    const restrictionRepo = AppDataSource.getRepository(UserTicketRestriction);
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

    // Check if this is a LEGACY ticket type that should use hardcoded modals
    const legacyTypes = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];
    if (legacyTypes.includes(selectedTypeId)) {
      enhancedLogger.debug(
        `Opening legacy modal for type: ${selectedTypeId}`,
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId, ticketType: selectedTypeId },
      );

      // Use legacy modal builders for legacy types
      let modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${selectedTypeId}`)
        .setTitle(`Create ${selectedTypeId.replace('_', ' ')} Ticket`);

      // Add inputs to modal based on ticketType
      switch (selectedTypeId) {
        case '18_verify':
          modal = await ageVerifyModal(modal);
          break;
        case 'ban_appeal':
          modal = await banAppealModal(modal);
          break;
        case 'player_report':
          modal = await playerReportModal(modal);
          break;
        case 'bug_report':
          modal = await bugReportModal(modal);
          break;
        case 'other':
          modal = await otherModal(modal);
          break;
      }

      // Show the modal (this is the ONLY response we can give)
      await interaction.showModal(modal);

      return;
    }

    // Get the custom ticket type details
    const typeRepo = AppDataSource.getRepository(CustomTicketType);
    const ticketType = await typeRepo.findOne({
      where: { guildId, typeId: selectedTypeId },
    });

    if (!ticketType) {
      await interaction.reply({
        content: '❌ Selected ticket type not found!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Build modal with custom fields or default description
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${ticketType.typeId}`)
      .setTitle(`${ticketType.emoji || '🎫'} ${ticketType.displayName}`);

    // Check if custom fields are configured
    if (ticketType.customFields && ticketType.customFields.length > 0) {
      // Use custom fields (max 5 fields per modal in Discord)
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
      // No custom fields - use default description field
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

    // Show the modal (this consumes the interaction)
    await interaction.showModal(modal);

    // Delete the ephemeral message after a short delay
    // We need to wait a bit for the modal to fully open
    setTimeout(async () => {
      try {
        // Delete the original ephemeral message
        await interaction.message.delete();
      } catch {
        // Silently fail - message might already be gone
      }
    }, 500);

    return;
  }

  /* Ticket Option Buttons */
  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
    const ticketType = interaction.customId.replace('ticket_', '');

    // Only handle valid ticket types (ignore bot setup buttons like ticket_skip, ticket_enable)
    const validTicketTypes = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];
    if (!validTicketTypes.includes(ticketType)) {
      return; // Not a ticket creation button, ignore it
    }

    enhancedLogger.debug(`Button: ticket_${ticketType}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      ticketType,
    });

    // build a modal for user input
    let modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${ticketType}`)
      .setTitle(`Create ${ticketType.replace('_', ' ')} Ticket`);

    // add inputs to modal based on ticketType
    switch (ticketType) {
      case '18_verify':
        modal = await ageVerifyModal(modal);
        break;
      case 'ban_appeal':
        modal = await banAppealModal(modal);
        break;
      case 'player_report':
        modal = await playerReportModal(modal);
        break;
      case 'bug_report':
        modal = await bugReportModal(modal);
        break;
      case 'other':
        modal = await otherModal(modal);
        break;
    }

    await interaction.showModal(modal);
  }

  // handle ticket modal submission
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
    const ticketType = interaction.customId.replace('ticket_modal_', '');
    const member = interaction.member as GuildMember;
    const guild = interaction.guild;
    const category = ticketConfig?.categoryId;

    enhancedLogger.debug(
      `Modal submit: ticket_modal_${ticketType}`,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, ticketType },
    );

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
      // get user input from modal
      const fields = interaction.fields;
      let description = '';

      // Check if this is a LEGACY ticket type
      const legacyTypes = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];
      const isLegacyType = legacyTypes.includes(ticketType);

      if (isLegacyType) {
        // Use legacy message builders for legacy types
        switch (ticketType) {
          case '18_verify':
            description = await ageVerifyMessage(fields);
            break;
          case 'ban_appeal':
            description = await banAppealMessage(fields);
            break;
          case 'player_report':
            description = await playerReportMessage(fields);
            break;
          case 'bug_report':
            description = await bugReportMessage(fields);
            break;
          case 'other':
            description = await otherMessage(fields);
            break;
        }
      } else {
        // Get the ticket type from database for custom types
        const typeRepo = AppDataSource.getRepository(CustomTicketType);
        const ticketTypeConfig = await typeRepo.findOne({
          where: { guildId, typeId: ticketType },
        });

        if (!ticketTypeConfig) {
          await interaction.reply({
            content: '❌ Ticket type configuration not found!',
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        // Build description from custom fields or default field
        // Add header with ticket type name
        const header = `# ${ticketTypeConfig.displayName}\n`;

        if (ticketTypeConfig.customFields && ticketTypeConfig.customFields.length > 0) {
          // Build formatted description from all custom field responses
          const fieldResponses: string[] = [];

          for (const field of ticketTypeConfig.customFields) {
            try {
              const value = fields.getTextInputValue(field.id);
              fieldResponses.push(`**${field.label}:** ${escapeDiscordMarkdown(value)}`);
            } catch {}
          }

          description = header + fieldResponses.join('\n');
        } else {
          // No custom fields - use default description field
          const defaultValue = fields.getTextInputValue('ticket_description');
          description = header + defaultValue;
        }
      }

      // Get ticket type details for channel naming
      let displayName = ticketType;

      if (isLegacyType) {
        // Use legacy names
        const legacyNames: Record<string, string> = {
          '18_verify': '18+ Verify',
          ban_appeal: 'Ban Appeal',
          player_report: 'Player Report',
          bug_report: 'Bug Report',
          other: 'Other',
        };
        displayName = legacyNames[ticketType] || ticketType;
      } else {
        // Get from database for custom types
        const typeRepo = AppDataSource.getRepository(CustomTicketType);
        const ticketTypeConfig = await typeRepo.findOne({
          where: { guildId, typeId: ticketType },
        });

        if (ticketTypeConfig) {
          displayName = ticketTypeConfig.displayName || ticketType;
        }
      }

      // create new ticket in the database
      const ticketData: Partial<Ticket> = {
        guildId: guildId,
        createdBy: interaction.user.id,
        type: ticketType,
      };

      if (!isLegacyType) {
        ticketData.customTypeId = ticketType;
      }

      const newTicket = ticketRepo.create(ticketData);
      const savedTicket = (await ticketRepo.save(newTicket)) as Ticket;

      // create the ticket channel with numbering (sanitized for Discord channel names)
      const sanitizedDisplayName = displayName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const sanitizedUsername = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const channelName =
        `${savedTicket.id}_${sanitizedDisplayName}_${sanitizedUsername}`.substring(0, 100);

      // get the staff/admin roles from the database
      const rolePerms = await savedRoleRepo
        .createQueryBuilder()
        .select(['type', 'role'])
        .where('guildId = :guildId', { guildId: guildId })
        .getRawMany();

      // Extract role IDs from mentions
      const staffRoleIds = rolePerms
        .map(role => extractIdFromMention(role.role))
        .filter((id): id is string => {
          if (!id) {
            enhancedLogger.warn(`Invalid role format encountered`, LogCategory.COMMAND_EXECUTION, {
              guildId,
            });
            return false;
          }
          return true;
        });

      // Use utility function to create permissions
      const permOverwrites = createPrivateChannelPermissions(
        guildId,
        [member.id],
        staffRoleIds,
        PermissionSets.TICKET_CREATOR,
      );

      // create the channel with all perms
      const channel = await guild.channels.create({
        name: channelName,
        type: 0, // text channel
        parent: category, // category
        permissionOverwrites: permOverwrites,
      });

      await interaction.reply({
        content: `${lang.ticket.created}${channel}`,
        flags: [MessageFlags.Ephemeral],
      });

      // send ticket welcome message with @ mention
      const welcomeMsg = `<@${member.user.id}>\n\n${lang.ticket.welcomeMsg}`;
      const buttonOptions = new ActionRowBuilder<ButtonBuilder>().setComponents(
        new ButtonBuilder()
          .setCustomId('admin_only_ticket')
          .setLabel('Admin Only')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger),
      );
      const descriptionMsg = `${description}`;
      const newChannel = channel as TextChannel;

      const welc = await newChannel.send({
        content: welcomeMsg,
        components: [buttonOptions],
      });
      await newChannel.send(`\u200B\n${descriptionMsg}`);

      // Check if staff should be pinged on ticket creation
      const botConfig = await botConfigRepo.findOneBy({ guildId });
      if (botConfig?.enableGlobalStaffRole && botConfig?.globalStaffRole) {
        let shouldPingStaff = false;

        if (isLegacyType) {
          // Check legacy type ping setting from TicketConfig
          const pingColumn = LEGACY_PING_COLUMNS[ticketType as LegacyType];
          if (pingColumn && ticketConfig) {
            shouldPingStaff = ticketConfig[pingColumn] as boolean;
          }
        } else {
          // Check custom type ping setting
          const customType = await customTypeRepo.findOneBy({
            guildId,
            typeId: ticketType,
          });
          shouldPingStaff = customType?.pingStaffOnCreate ?? true;
        }

        if (shouldPingStaff) {
          await newChannel.send({
            content: `${botConfig.globalStaffRole}\n📨 A new **${displayName}** ticket has been created!`,
          });
        }
      }

      ticketRepo.update(
        { id: savedTicket.id },
        {
          messageId: welc.id,
          channelId: newChannel.id,
          status: 'opened',
        },
      );

      enhancedLogger.info(
        `Ticket created: #${savedTicket.id} (${ticketType})`,
        LogCategory.COMMAND_EXECUTION,
        {
          userId: interaction.user.id,
          guildId,
          ticketId: savedTicket.id,
          ticketType,
          channelId: newChannel.id,
        },
      );
    } catch (error) {
      enhancedLogger.error(
        'Failed to create ticket',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId, ticketType },
      );
      await interaction.reply({
        content: lang.ticket.error,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  }

  /* MAKING A TICKET ADMIN ONLY */
  if (interaction.isButton() && interaction.customId === 'admin_only_ticket') {
    enhancedLogger.debug(`Button: admin_only_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });

    // build a confirmation message with buttons
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_admin_only_ticket')
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_admin_only_ticket')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: lang.ticket.adminOnly.confirm,
      components: [confirmRow],
      flags: [MessageFlags.Ephemeral],
    });
  }
  if (interaction.isButton() && interaction.customId === 'confirm_admin_only_ticket') {
    enhancedLogger.debug(`Button: confirm_admin_only_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });
    await interaction.update({
      content: lang.ticket.adminOnly.changing,
      components: [],
    });
    await ticketAdminOnlyEvent(client, interaction);
  }
  if (interaction.isButton() && interaction.customId === 'cancel_admin_only_ticket') {
    enhancedLogger.debug(`Button: cancel_admin_only_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });
    await interaction.update({
      content: lang.ticket.adminOnly.cancel,
      components: [],
    });
  }

  /* CLOSING A TICKET */
  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    enhancedLogger.debug(`Button: close_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });

    // build a confirmation message with buttons
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_close_ticket')
        .setLabel('Confirm Close')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_close_ticket')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: lang.ticket.close.confirm,
      components: [confirmRow],
      flags: [MessageFlags.Ephemeral],
    });
  }
  if (interaction.isButton() && interaction.customId === 'confirm_close_ticket') {
    enhancedLogger.debug(`Button: confirm_close_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });
    await interaction.update({
      content: lang.ticket.close.closing,
      components: [],
    });
    await ticketCloseEvent(client, interaction);
  }
  if (interaction.isButton() && interaction.customId === 'cancel_close_ticket') {
    enhancedLogger.debug(`Button: cancel_close_ticket`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });
    await interaction.update({
      content: lang.ticket.close.cancel,
      components: [],
    });
  }
};
