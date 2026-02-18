/**
 * Config Status Embed Builder
 *
 * Generic utility for building configuration status embeds
 * used by setup commands (ticket-setup, application-setup, etc.)
 */

import { EmbedBuilder } from 'discord.js';
import { Colors } from '../colors';
import { E } from '../emojis';

export interface ConfigItem {
  /** Display label (e.g., "Channel", "Archive", "Category") */
  label: string;
  /** Channel mention or display value if configured, null if not */
  value: string | null;
  /** Description shown when not configured (e.g., "Text channel for tickets") */
  missingDescription: string;
}

export interface ConfigStatusOptions {
  /** System name (e.g., "Ticket System", "Application System") */
  systemName: string;
  /** Config items to display */
  items: ConfigItem[];
  /** Whether any items were just updated this invocation */
  hasUpdates: boolean;
}

/**
 * Builds a configuration status embed showing which items are configured
 * and which are missing.
 *
 * @param options - Config status display options
 * @returns EmbedBuilder ready to send
 */
export function buildConfigStatusEmbed(options: ConfigStatusOptions): EmbedBuilder {
  const { systemName, items, hasUpdates } = options;

  const configured = items.filter(i => i.value !== null);
  const missing = items.filter(i => i.value === null);
  const isFullyConfigured = missing.length === 0;

  const embed = new EmbedBuilder().setTimestamp();

  if (isFullyConfigured) {
    embed.setTitle(`${systemName} Configuration`);
    embed.setColor(Colors.status.success);
  } else if (configured.length > 0) {
    embed.setTitle(`${systemName} Configuration`);
    embed.setColor(Colors.status.warning);
  } else {
    embed.setTitle(`${systemName} Configuration`);
    embed.setColor(Colors.status.info);
  }

  // Build status lines
  const lines: string[] = [];
  for (const item of items) {
    if (item.value !== null) {
      lines.push(`**${item.label}:** ${item.value} ${E.ok}`);
    } else {
      lines.push(`**${item.label}:** ${E.error} Not configured`);
    }
  }

  let description = lines.join('\n');

  if (isFullyConfigured) {
    description += hasUpdates
      ? `\n\n${E.ok} Configuration updated! System is fully operational.`
      : `\n\n${E.ok} System is fully operational.`;
  } else if (missing.length > 0) {
    description += `\n\n${E.warn} The following must be set for full functionality:`;
    for (const item of missing) {
      description += `\n• **${item.label}** — ${item.missingDescription}`;
    }
  }

  embed.setDescription(description);

  return embed;
}
