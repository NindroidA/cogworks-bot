import type { CacheType, ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { StarboardConfig } from '../../../typeorm/entities/starboard';
import { handleInteractionError, LANGF, lang, requireAdmin } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const configRepo = lazyRepo(StarboardConfig);
const tl = lang.starboard;

/**
 * Handle /starboard ignore <channel>
 */
export async function starboardIgnoreHandler(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guildId!;
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await interaction.reply({
        content: tl.setup.notConfigured,
        flags: [MessageFlags.Ephemeral],
      });
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
      content: LANGF(tl.ignore.added, `<#${channel.id}>`),
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
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guildId!;
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await interaction.reply({
        content: tl.setup.notConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const ignored = config.ignoredChannels || [];
    const idx = ignored.indexOf(channel.id);

    if (idx === -1) {
      await interaction.reply({
        content: tl.ignore.notIgnored,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    ignored.splice(idx, 1);
    config.ignoredChannels = ignored.length > 0 ? ignored : null;
    await configRepo.save(config);

    await interaction.reply({
      content: LANGF(tl.ignore.removed, `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard unignore failed');
  }
}
