import { type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors, handleInteractionError, lang } from '../../utils';

const tl = lang.general.coffee;
const COFFEE_URL = 'https://buymeacoffee.com/nindroida';

/**
 * Handler for /coffee command
 * Shows support message with Buy Me a Coffee link
 */
export async function coffeeHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const embed = new EmbedBuilder()
      .setTitle(tl.title)
      .setDescription(`${tl.description}\n\n[Buy Me a Coffee](${COFFEE_URL})`)
      .setColor(Colors.brand.primary)
      .setFooter({ text: tl.footer });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    await handleInteractionError(interaction, error, 'coffeeHandler');
  }
}
