/**
 * AutoMod Handler Router
 *
 * Routes to the appropriate handler based on subcommand group.
 * All subcommands require admin permissions.
 */

import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { guardFeatureRateLimit, handleInteractionError, lang, RateLimits, replyEphemeralError } from '../../../utils';
import { backupHandler } from './backup';
import { keywordHandler } from './keyword';
import { ruleHandler } from './rule';
import { templateHandler } from './template';

export async function automodHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const guard = await guardFeatureRateLimit(interaction, 'automod', 'manage', {
      action: 'automod',
      limit: RateLimits.BAIT_CHANNEL,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    if (!interaction.guildId) return;
    const subcommandGroup = interaction.options.getSubcommandGroup(true);

    switch (subcommandGroup) {
      case 'rule':
        await ruleHandler(client, interaction);
        break;

      case 'template':
        await templateHandler(client, interaction);
        break;

      case 'backup':
        await backupHandler(client, interaction);
        break;

      case 'keyword':
      case 'regex':
      case 'exempt':
        await keywordHandler(client, interaction);
        break;

      default:
        await replyEphemeralError(interaction, lang.errors.unknownSubcommand);
    }
  } catch (error) {
    await handleInteractionError(interaction, error, lang.automod.error.general);
  }
}

/**
 * Autocomplete handler for AutoMod rule selection.
 * Returns all AutoMod rules in the guild as autocomplete options.
 */
export async function handleAutomodAutocomplete(
  interaction: import('discord.js').AutocompleteInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.respond([]);
    return;
  }

  try {
    const rules = await interaction.guild.autoModerationRules.fetch();
    const focusedValue = interaction.options.getFocused().toLowerCase();

    const filtered = focusedValue ? rules.filter(r => r.name.toLowerCase().includes(focusedValue)) : rules;

    await interaction.respond(
      [...filtered.values()].slice(0, 25).map(r => ({
        name: r.name,
        value: r.id,
      })),
    );
  } catch {
    await interaction.respond([]);
  }
}
