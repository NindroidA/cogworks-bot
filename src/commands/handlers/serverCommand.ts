import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { Colors, handleInteractionError, lang, requireAdmin } from '../../utils';

const tl = lang.general.server;
const INVITE_URL = 'https://discord.gg/nkwMUaVSYH';

/**
 * Handler for /server command
 * Shows the Cogworks development Discord server invite link
 */
export async function serverCommandHandler(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setTitle(tl.title)
      .setDescription(tl.description)
      .setColor(Colors.brand.primary)
      .setTimestamp();

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel(tl.buttonLabel).setURL(INVITE_URL).setStyle(ButtonStyle.Link),
    );

    await interaction.reply({
      embeds: [embed],
      components: [buttonRow],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'serverCommandHandler');
  }
}
