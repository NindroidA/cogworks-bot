/**
 * AutoMod Handler Router
 *
 * Routes to the appropriate handler based on subcommand group.
 * All subcommands require admin permissions.
 */

import { type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import {
  createRateLimitKey,
  enhancedLogger,
  handleInteractionError,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';
import { backupHandler } from './backup';
import { keywordHandler } from './keyword';
import { ruleHandler } from './rule';
import { templateHandler } from './template';

export const automodHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    // Require admin permissions for all automod subcommands
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guildId || !interaction.guild) return;
    const guildId = interaction.guildId;
    const subcommandGroup = interaction.options.getSubcommandGroup(true);

    // Rate limit check (guild-scoped: 10 automod operations per hour)
    const rateLimitKey = createRateLimitKey.guild(guildId, 'automod');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BAIT_CHANNEL);

    if (!rateCheck.allowed) {
      await interaction.reply({
        content: LANGF(
          lang.errors.rateLimit,
          Math.ceil((rateCheck.resetIn || 0) / 60000).toString(),
        ),
        flags: [MessageFlags.Ephemeral],
      });
      enhancedLogger.warn(
        `Rate limit exceeded for automod command in guild ${guildId}`,
        LogCategory.SECURITY,
      );
      return;
    }

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
        await interaction.reply({
          content: lang.errors.unknownSubcommand,
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, lang.automod.error.general);
  }
};

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

    const filtered = focusedValue
      ? rules.filter(r => r.name.toLowerCase().includes(focusedValue))
      : rules;

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
