import type { CacheType, ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { StarboardConfig } from '../../../typeorm/entities/starboard';
import { formatLang, guardFeatureAccess, handleInteractionError, lang, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const configRepo = lazyRepo(StarboardConfig);
const tl = lang.starboard;

/**
 * Handle /starboard setup <channel> [emoji] [threshold]
 */
export async function starboardSetupHandler(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'starboard', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const channel = interaction.options.getChannel('channel', true);
    const emoji = interaction.options.getString('emoji') || '\u2B50';
    const threshold = interaction.options.getInteger('threshold') || 3;

    let config = await configRepo.findOneBy({ guildId });

    if (config) {
      config.channelId = channel.id;
      config.emoji = emoji;
      config.threshold = threshold;
      config.enabled = true;
    } else {
      config = configRepo.create({
        guildId,
        channelId: channel.id,
        emoji,
        threshold,
        enabled: true,
      });
    }

    await configRepo.save(config);

    await interaction.reply({
      content: formatLang(tl.setup.success, threshold.toString(), emoji, `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard setup failed');
  }
}

/**
 * Handle /starboard config <setting> <value>
 */
export async function starboardConfigHandler(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'starboard', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await replyEphemeralError(interaction, tl.setup.notConfigured);
      return;
    }

    const setting = interaction.options.getString('setting', true);
    const value = interaction.options.getString('value', true);

    switch (setting) {
      case 'emoji':
        config.emoji = value;
        break;
      case 'threshold': {
        const num = Number.parseInt(value, 10);
        if (Number.isNaN(num) || num < 1 || num > 25) {
          await replyEphemeralError(interaction, tl.setup.thresholdRange);
          return;
        }
        config.threshold = num;
        break;
      }
      case 'self-star':
        config.selfStar = value.toLowerCase() === 'true';
        break;
      case 'ignore-bots':
        config.ignoreBots = value.toLowerCase() === 'true';
        break;
      case 'ignore-nsfw':
        config.ignoreNSFW = value.toLowerCase() === 'true';
        break;
    }

    await configRepo.save(config);

    await interaction.reply({
      content: tl.setup.configUpdated,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard config update failed');
  }
}

/**
 * Handle /starboard toggle
 */
export async function starboardToggleHandler(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'starboard', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await replyEphemeralError(interaction, tl.setup.notConfigured);
      return;
    }

    config.enabled = !config.enabled;
    await configRepo.save(config);

    await interaction.reply({
      content: config.enabled ? tl.setup.enabled : tl.setup.disabled,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard toggle failed');
  }
}
