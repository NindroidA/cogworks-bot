import type { ButtonInteraction, Client } from 'discord.js';
import { buildPostSubmitButtons, buildTypeConfirmationEmbed } from '../../commands/handlers/ticket/typeAdd';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, guardFeatureAccess, LogCategory, lang, replyEphemeralError } from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';

const customTypeRepo = lazyRepo(CustomTicketType);

export const pingToggleButton = async (_client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  // Auth gate: this button mutates TicketConfig staff-ping columns, the same
  // write surface as the guarded slash command form. Without this check a
  // non-admin who can see the message can re-click the button at any time.
  const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
  if (!guard.allowed) return;

  const typeId = interaction.customId.replace('ticket_type_ping_toggle:', '');
  enhancedLogger.debug(`Button: staff ping toggle for type '${typeId}'`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    typeId,
  });

  const type = await customTypeRepo.findOne({ where: { guildId, typeId } });

  if (!type) {
    enhancedLogger.warn(`Staff ping toggle failed: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
    });
    await replyEphemeralError(interaction, lang.ticket.customTypes.typeEdit.notFound);
    return;
  }

  const previousState = type.pingStaffOnCreate;
  type.pingStaffOnCreate = !type.pingStaffOnCreate;
  await customTypeRepo.save(type);

  enhancedLogger.info(
    `Type ping toggled: '${typeId}' ${previousState} → ${type.pingStaffOnCreate}`,
    LogCategory.COMMAND_EXECUTION,
    {
      userId: interaction.user.id,
      guildId,
      typeId,
      previousState,
      newState: type.pingStaffOnCreate,
    },
  );

  await interaction.update({
    embeds: [buildTypeConfirmationEmbed(type, 'updated')],
    components: [buildPostSubmitButtons(type)],
  });
};

/**
 * Toggles `isActive` for a custom ticket type — paired with the post-submit
 * Activate/Deactivate button rendered alongside the staff-ping toggle.
 * customId: `ticket_type_active_toggle:<typeId>`.
 */
export const activeToggleButton = async (_client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
  if (!guard.allowed) return;

  const typeId = interaction.customId.replace('ticket_type_active_toggle:', '');
  enhancedLogger.debug(`Button: active toggle for type '${typeId}'`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    typeId,
  });

  const type = await customTypeRepo.findOne({ where: { guildId, typeId } });
  if (!type) {
    enhancedLogger.warn(`Active toggle failed: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
    });
    await replyEphemeralError(interaction, lang.ticket.customTypes.typeEdit.notFound);
    return;
  }

  const previousState = type.isActive;
  type.isActive = !type.isActive;
  await customTypeRepo.save(type);

  enhancedLogger.info(
    `Type active toggled: '${typeId}' ${previousState} → ${type.isActive}`,
    LogCategory.COMMAND_EXECUTION,
    {
      userId: interaction.user.id,
      guildId,
      typeId,
      previousState,
      newState: type.isActive,
    },
  );

  await interaction.update({
    embeds: [buildTypeConfirmationEmbed(type, 'updated')],
    components: [buildPostSubmitButtons(type)],
  });
};
