import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { Colors, E, enhancedLogger, LANGF, LogCategory, lang } from '../../../utils';

const tl = lang.ticket.settings;

// Legacy ticket type IDs
const LEGACY_TYPES = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'] as const;
type LegacyType = (typeof LEGACY_TYPES)[number];

// Map legacy type IDs to their TicketConfig column names
const LEGACY_TYPE_COLUMNS: Record<LegacyType, keyof TicketConfig> = {
  '18_verify': 'pingStaffOn18Verify',
  ban_appeal: 'pingStaffOnBanAppeal',
  player_report: 'pingStaffOnPlayerReport',
  bug_report: 'pingStaffOnBugReport',
  other: 'pingStaffOnOther',
};

// Display names for legacy types
const LEGACY_TYPE_NAMES: Record<LegacyType, string> = {
  '18_verify': '18+ Verification',
  ban_appeal: 'Ban Appeal',
  player_report: 'Player Report',
  bug_report: 'Bug Report',
  other: 'Other',
};

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
    await interaction.reply({
      content: lang.general.cmdGuildNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const setting = interaction.options.getString('setting', true);
  const enabled = interaction.options.getBoolean('enabled', true);
  const typeId = interaction.options.getString('type');

  enhancedLogger.debug(
    `Command: /ticket settings ${setting}=${enabled}`,
    LogCategory.COMMAND_EXECUTION,
    { userId: interaction.user.id, guildId, setting, enabled, typeId },
  );

  const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

  if (!ticketConfig) {
    enhancedLogger.warn('Settings handler: ticketConfig not found', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (setting === 'admin-only-mention') {
    await ticketConfigRepo.update({ guildId }, { adminOnlyMentionStaff: enabled });
    enhancedLogger.info(
      `Setting updated: admin-only-mention=${enabled}`,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, setting, enabled },
    );

    const embed = new EmbedBuilder()
      .setTitle(`${E.ok} ${tl.updated}`)
      .setDescription(enabled ? tl.adminOnlyMentionEnabled : tl.adminOnlyMentionDisabled)
      .setColor(Colors.status.success)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (setting === 'ping-on-create') {
    // Type is required for this setting
    if (!typeId) {
      enhancedLogger.warn(
        'Settings handler: type required for ping-on-create',
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await interaction.reply({
        content: tl.typeRequired,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    let displayName: string;

    // Check if it's a legacy type
    if (LEGACY_TYPES.includes(typeId as LegacyType)) {
      const columnName = LEGACY_TYPE_COLUMNS[typeId as LegacyType];
      displayName = LEGACY_TYPE_NAMES[typeId as LegacyType];

      // Update the legacy type's ping setting
      await ticketConfigRepo.update({ guildId }, { [columnName]: enabled });
    } else {
      // It's a custom type
      const customTypeRepo = AppDataSource.getRepository(CustomTicketType);
      const customType = await customTypeRepo.findOneBy({ guildId, typeId });

      if (!customType) {
        enhancedLogger.warn(
          `Settings handler: type '${typeId}' not found`,
          LogCategory.COMMAND_EXECUTION,
          { userId: interaction.user.id, guildId, typeId },
        );
        await interaction.reply({
          content: LANGF(tl.typeNotFound, typeId),
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      displayName = customType.displayName;
      await customTypeRepo.update({ guildId, typeId }, { pingStaffOnCreate: enabled });
    }

    enhancedLogger.info(
      `Setting updated: ping-on-create for '${typeId}'=${enabled}`,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, setting, typeId, enabled },
    );

    const embed = new EmbedBuilder()
      .setTitle(`${E.ok} ${tl.updated}`)
      .setDescription(
        enabled
          ? LANGF(tl.pingOnCreateEnabled, displayName)
          : LANGF(tl.pingOnCreateDisabled, displayName),
      )
      .setColor(Colors.status.success)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  }
}
