import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { Colors, guardAdmin, handleInteractionError, lang } from '../../utils';

const tl = lang.general.server;
const INVITE_URL = 'https://discord.gg/nkwMUaVSYH';

/**
 * Handler for /server command
 * Shows the Cogworks development Discord server invite link
 */
export async function serverCommandHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  const guard = await guardAdmin(interaction);
  if (!guard.allowed) return;

  try {
    const embed = new EmbedBuilder().setTitle(tl.title).setDescription(tl.description).setColor(Colors.brand.primary);

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
