import type { CacheType, ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { StarboardConfig } from '../../../typeorm/entities/starboard';
import { handleInteractionError, LANGF, lang, requireAdmin } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const configRepo = lazyRepo(StarboardConfig);
const tl = lang.starboard;

/**
 * Handle /starboard setup <channel> [emoji] [threshold]
 */
export const starboardSetupHandler = async (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> => {
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
      content: LANGF(tl.setup.success, threshold.toString(), emoji, `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard setup failed');
  }
};

/**
 * Handle /starboard config <setting> <value>
 */
export const starboardConfigHandler = async (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> => {
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

    const setting = interaction.options.getString('setting', true);
    const value = interaction.options.getString('value', true);

    switch (setting) {
      case 'emoji':
        config.emoji = value;
        break;
      case 'threshold': {
        const num = Number.parseInt(value, 10);
        if (Number.isNaN(num) || num < 1 || num > 25) {
          await interaction.reply({
            content: tl.setup.thresholdRange,
            flags: [MessageFlags.Ephemeral],
          });
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
};

/**
 * Handle /starboard toggle
 */
export const starboardToggleHandler = async (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> => {
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

    config.enabled = !config.enabled;
    await configRepo.save(config);

    await interaction.reply({
      content: config.enabled ? tl.setup.enabled : tl.setup.disabled,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard toggle failed');
  }
};
