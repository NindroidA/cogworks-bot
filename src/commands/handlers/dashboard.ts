import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Colors, handleInteractionError, lang } from "../../utils";

const tl = lang.general.dashboard;
const DASHBOARD_URL =
  process.env.DASHBOARD_URL || "https://cogworks.nindroidsystems.com/dashboard";

/**
 * Handler for /dashboard command
 * Sends a link to the Cogworks web dashboard with Discord OAuth
 */
export async function dashboardHandler(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    const embed = new EmbedBuilder()
      .setTitle(tl.title)
      .setDescription(tl.description)
      .setColor(Colors.brand.primary)
      .setFooter({ text: tl.footer });

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(tl.buttonLabel)
        .setURL(DASHBOARD_URL)
        .setStyle(ButtonStyle.Link),
    );

    await interaction.reply({
      embeds: [embed],
      components: [buttonRow],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, "dashboardHandler");
  }
}
