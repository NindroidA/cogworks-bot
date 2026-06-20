import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import {
  Colors,
  E,
  enhancedLogger,
  formatLang,
  guardFeatureAccess,
  LogCategory,
  lang,
  replyEphemeralError,
} from '../../../utils';
import { builtinTypeInfo, isBuiltinTicketType, resolveBuiltinPingColumn } from '../../../utils/ticket/builtinTypes';

const tl = lang.ticket.settings;

/**
 * Handler for /ticket settings command
 * Allows configuring ticket system settings
 */
export async function settingsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    enhancedLogger.warn('Settings handler: guild not found', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
    });
    await replyEphemeralError(interaction, lang.general.cmdGuildNotFound);
    return;
  }

  // Permission check: only admins can modify ticket settings
  const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
  if (!guard.allowed) return;

  const setting = interaction.options.getString('setting', true);
  const enabled = interaction.options.getBoolean('enabled', true);
  const typeId = interaction.options.getString('type');

  enhancedLogger.debug(`Command: /ticket settings ${setting}=${enabled}`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    setting,
    enabled,
    typeId,
  });

  const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

  if (!ticketConfig) {
    enhancedLogger.warn('Settings handler: ticketConfig not found', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });
    await replyEphemeralError(interaction, lang.ticket.ticketConfigNotFound);
    return;
  }

  if (setting === 'admin-only-mention') {
    await ticketConfigRepo.update({ guildId }, { adminOnlyMentionStaff: enabled });
    enhancedLogger.info(`Setting updated: admin-only-mention=${enabled}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      setting,
      enabled,
    });

    const embed = new EmbedBuilder()
      .setTitle(`${E.ok} ${tl.updated}`)
      .setDescription(enabled ? tl.adminOnlyMentionEnabled : tl.adminOnlyMentionDisabled)
      .setColor(Colors.status.success);

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (setting === 'ping-on-create') {
    // Type is required for this setting
    if (!typeId) {
      enhancedLogger.warn('Settings handler: type required for ping-on-create', LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
      });
      await replyEphemeralError(interaction, tl.typeRequired);
      return;
    }

    let displayName: string;

    // Check if it's a builtin type
    if (isBuiltinTicketType(typeId)) {
      const columnName = resolveBuiltinPingColumn(typeId);
      displayName = builtinTypeInfo(typeId)?.displayName ?? typeId;

      if (columnName) {
        // Update the builtin type's ping setting
        await ticketConfigRepo.update({ guildId }, { [columnName]: enabled });
      }
    } else {
      // It's a custom type
      const customTypeRepo = AppDataSource.getRepository(CustomTicketType);
      const customType = await customTypeRepo.findOneBy({ guildId, typeId });

      if (!customType) {
        enhancedLogger.warn(`Settings handler: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION, {
          userId: interaction.user.id,
          guildId,
          typeId,
        });
        await replyEphemeralError(interaction, formatLang(tl.typeNotFound, typeId));
        return;
      }

      displayName = customType.displayName;
      await customTypeRepo.update({ guildId, typeId }, { pingStaffOnCreate: enabled });
    }

    enhancedLogger.info(`Setting updated: ping-on-create for '${typeId}'=${enabled}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      setting,
      typeId,
      enabled,
    });

    const embed = new EmbedBuilder()
      .setTitle(`${E.ok} ${tl.updated}`)
      .setDescription(
        enabled ? formatLang(tl.pingOnCreateEnabled, displayName) : formatLang(tl.pingOnCreateDisabled, displayName),
      )
      .setColor(Colors.status.success);

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  }
}
