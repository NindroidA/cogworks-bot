import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  MessageFlags,
} from 'discord.js';
import { buildTypeConfirmationEmbed } from '../../commands/handlers/ticket/typeAdd';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, LogCategory, lang } from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';

const customTypeRepo = lazyRepo(CustomTicketType);

export const pingToggleButton = async (_client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

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
    await interaction.reply({
      content: lang.ticket.customTypes.typeEdit.notFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

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

  const embed = buildTypeConfirmationEmbed(type, false);
  const tl = lang.ticket.customTypes.typeAdd;
  const toggleButton = new ButtonBuilder()
    .setCustomId(`ticket_type_ping_toggle:${typeId}`)
    .setLabel(type.pingStaffOnCreate ? tl.pingToggleDisable : tl.pingToggleEnable)
    .setStyle(type.pingStaffOnCreate ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(type.pingStaffOnCreate ? '🔕' : '🔔');

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(toggleButton);

  await interaction.update({ embeds: [embed], components: [buttonRow] });
};
