import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Colors, E, lang } from '../../utils';

const tl = lang.general.ping;

/**
 * Formats uptime in a human-readable format
 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

/**
 * Handler for /ping command
 * Shows bot latency and status information
 */
export async function pingHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  const response = await interaction.reply({
    content: tl.calculating,
    flags: [MessageFlags.Ephemeral],
    withResponse: true,
  });

  const sent = response.resource?.message;
  const roundtrip = sent ? sent.createdTimestamp - interaction.createdTimestamp : 0;
  const wsLatency = interaction.client.ws.ping;
  const uptime = process.uptime();

  const embed = new EmbedBuilder()
    .setTitle(`${E.ok} ${tl.title}`)
    .setColor(Colors.status.success)
    .addFields(
      { name: tl.wsLatency, value: `${wsLatency}ms`, inline: true },
      { name: tl.apiLatency, value: `${roundtrip}ms`, inline: true },
      { name: tl.uptime, value: formatUptime(uptime), inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
