import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, handleInteractionError, LANGF, LogCategory, lang } from '../../../utils';

const tl = lang.ticket.customTypes.typeDefault;

/**
 * Handler for /ticket type-default command
 * Sets the default ticket type for the guild
 */
export async function typeDefaultHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.guild) {
      enhancedLogger.warn('Type-default handler: guild not found', LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
      });
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guild.id;
    const typeId = interaction.options.getString('type', true);

    enhancedLogger.debug(
      `Command: /ticket type-default type=${typeId}`,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, typeId },
    );

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const type = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!type) {
      enhancedLogger.warn(
        `Type-default: type '${typeId}' not found`,
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId, typeId },
      );
      await interaction.reply({
        content: tl.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!type.isActive) {
      enhancedLogger.warn(
        `Type-default: type '${typeId}' is inactive`,
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId, typeId },
      );
      await interaction.reply({
        content: tl.mustBeActive,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Remove default flag from all other types
    await typeRepo.update({ guildId, isDefault: true }, { isDefault: false });

    // Set this type as default
    type.isDefault = true;
    await typeRepo.save(type);

    enhancedLogger.info(`Default type set: '${typeId}'`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
      displayName: type.displayName,
    });

    await interaction.reply({
      content: LANGF(tl.success, type.displayName),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeDefaultHandler');
  }
}
