import type { CacheType, ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { StarboardConfig } from '../../../typeorm/entities/starboard';
import { formatLang, guardFeatureAccess, handleInteractionError, lang, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const configRepo = lazyRepo(StarboardConfig);
const tl = lang.starboard;

/**
 * Handle /starboard ignore <channel>
 */
export async function starboardIgnoreHandler(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'starboard', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await replyEphemeralError(interaction, tl.setup.notConfigured);
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const ignored = config.ignoredChannels || [];

    if (!ignored.includes(channel.id)) {
      ignored.push(channel.id);
      config.ignoredChannels = ignored;
      await configRepo.save(config);
    }

    await interaction.reply({
      content: formatLang(tl.ignore.added, `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard ignore failed');
  }
}

/**
 * Handle /starboard unignore <channel>
 */
export async function starboardUnignoreHandler(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'starboard', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await replyEphemeralError(interaction, tl.setup.notConfigured);
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const ignored = config.ignoredChannels || [];
    const idx = ignored.indexOf(channel.id);

    if (idx === -1) {
      await replyEphemeralError(interaction, tl.ignore.notIgnored);
      return;
    }

    ignored.splice(idx, 1);
    config.ignoredChannels = ignored.length > 0 ? ignored : null;
    await configRepo.save(config);

    await interaction.reply({
      content: formatLang(tl.ignore.removed, `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard unignore failed');
  }
}
