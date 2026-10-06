import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import {
  enhancedLogger,
  formatLang,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  replyEphemeralError,
} from '../../../utils';
import { setDefaultTicketType } from './typeList';

const tl = lang.ticket.customTypes.typeDefault;

/**
 * Handler for /ticket type-default command
 * Sets the default ticket type for the guild
 */
export async function typeDefaultHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const typeId = interaction.options.getString('type', true);

    enhancedLogger.debug(`Command: /ticket type-default type=${typeId}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
    });

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const type = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!type) {
      enhancedLogger.warn(`Type-default: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        typeId,
      });
      await replyEphemeralError(interaction, tl.notFound);
      return;
    }

    if (!type.isActive) {
      enhancedLogger.warn(`Type-default: type '${typeId}' is inactive`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        typeId,
      });
      await replyEphemeralError(interaction, tl.mustBeActive);
      return;
    }

    // Clear the old default and set this one in one transaction
    await setDefaultTicketType(guildId, typeId);

    enhancedLogger.info(`Default type set: '${typeId}'`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
      displayName: type.displayName,
    });

    await interaction.reply({
      content: formatLang(tl.success, type.displayName),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeDefaultHandler');
  }
}
