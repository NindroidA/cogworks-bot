import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, handleInteractionError, LANGF, LogCategory, lang } from '../../../utils';

const tl = lang.ticket.customTypes.typeList;

/**
 * Handler for /ticket type-list command
 * Displays all custom ticket types for the guild
 */
export async function typeListHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.guild) {
      enhancedLogger.warn('Type-list handler: guild not found', LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
      });
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guild.id;
    enhancedLogger.debug(`Command: /ticket type-list`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const types = await typeRepo.find({
      where: { guildId },
      order: { sortOrder: 'ASC' },
    });

    if (types.length === 0) {
      await interaction.reply({
        content: tl.noTypes,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const embed = new EmbedBuilder().setTitle(tl.title).setColor('#0099ff').setTimestamp();

    for (const type of types) {
      const status = type.isActive ? tl.activeLabel : tl.inactiveLabel;
      const defaultTag = type.isDefault ? tl.defaultLabel : '';
      const colorBox = `\`${type.embedColor}\``;
      const desc = type.description ? `*${type.description}*` : '';

      const fieldValue = LANGF(tl.fieldValue, type.typeId, colorBox, status, defaultTag, desc);

      embed.addFields({
        name: `${type.emoji || '❓'} ${type.displayName}`,
        value: fieldValue,
        inline: false,
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeListHandler');
  }
}
