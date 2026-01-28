import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Colors, lang } from '../../utils';

const tl = lang.general.coffee;
const COFFEE_URL = 'https://buymeacoffee.com/nindroida';

/**
 * Handler for /coffee command
 * Shows support message with Buy Me a Coffee link
 */
export async function coffeeHandler(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
        .setTitle(tl.title)
        .setDescription(tl.description)
        .setColor(Colors.brand.primary)
        .addFields({
            name: tl.linkTitle,
            value: `[${COFFEE_URL}](${COFFEE_URL})`
        })
        .setFooter({ text: tl.footer })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
