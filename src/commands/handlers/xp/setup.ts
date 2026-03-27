import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import xpLang from '../../../lang/xp.json';
import { XPConfig } from '../../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { enhancedLogger, handleInteractionError, LogCategory } from '../../../utils';
import { Colors } from '../../../utils/colors';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const configRepo = lazyRepo(XPConfig);
const rewardRepo = lazyRepo(XPRoleReward);

/** 5-minute TTL cache for XP config (like bait channel config) */
const configCache = new Map<string, { config: XPConfig; cachedAt: number }>();
const CONFIG_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get XP config for a guild with caching.
 * Exported so event handlers and other modules can use it.
 */
export async function getXPConfig(guildId: string): Promise<XPConfig | null> {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL) {
    return cached.config;
  }

  const config = await configRepo.findOne({ where: { guildId } });
  if (config) {
    configCache.set(guildId, { config, cachedAt: Date.now() });
  } else {
    configCache.delete(guildId);
  }
  return config;
}

/** Invalidate the config cache for a guild (call after updates). */
export function invalidateXPConfigCache(guildId: string): void {
  configCache.delete(guildId);
}

/** Clear the entire XP config cache. */
export function clearXPConfigCache(): void {
  configCache.clear();
}

export const xpSetupHandler = async (_client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'enable':
        await handleEnable(interaction, guildId);
        break;
      case 'disable':
        await handleDisable(interaction, guildId);
        break;
      case 'config':
        await handleConfig(interaction, guildId);
        break;
      case 'role-reward-add':
        await handleRoleRewardAdd(interaction, guildId);
        break;
      case 'role-reward-remove':
        await handleRoleRewardRemove(interaction, guildId);
        break;
      case 'role-reward-list':
        await handleRoleRewardList(interaction, guildId);
        break;
      case 'ignore-channel-add':
        await handleIgnoreChannelAdd(interaction, guildId);
        break;
      case 'ignore-channel-remove':
        await handleIgnoreChannelRemove(interaction, guildId);
        break;
      case 'multiplier-set':
        await handleMultiplierSet(interaction, guildId);
        break;
      case 'multiplier-remove':
        await handleMultiplierRemove(interaction, guildId);
        break;
      case 'import-mee6':
        await handleImportMee6(interaction, guildId);
        break;
      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute XP setup command');
  }
};

async function getOrCreateConfig(guildId: string): Promise<XPConfig> {
  let config = await configRepo.findOne({ where: { guildId } });
  if (!config) {
    config = configRepo.create({ guildId });
    config = await configRepo.save(config);
  }
  return config;
}

async function handleEnable(interaction: ChatInputCommandInteraction, guildId: string) {
  const config = await getOrCreateConfig(guildId);
  if (config.enabled) {
    await interaction.reply({
      content: xpLang.setup.alreadyEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  config.enabled = true;
  await configRepo.save(config);
  invalidateXPConfigCache(guildId);

  enhancedLogger.info(`XP system enabled for guild ${guildId}`, LogCategory.COMMAND_EXECUTION);
  await interaction.reply({
    content: xpLang.setup.enabled,
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleDisable(interaction: ChatInputCommandInteraction, guildId: string) {
  const config = await configRepo.findOne({ where: { guildId } });
  if (!config || !config.enabled) {
    await interaction.reply({
      content: xpLang.setup.alreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  config.enabled = false;
  await configRepo.save(config);
  invalidateXPConfigCache(guildId);

  enhancedLogger.info(`XP system disabled for guild ${guildId}`, LogCategory.COMMAND_EXECUTION);
  await interaction.reply({
    content: xpLang.setup.disabled,
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleConfig(interaction: ChatInputCommandInteraction, guildId: string) {
  const setting = interaction.options.getString('setting', true);
  const value = interaction.options.getString('value');
  const channel = interaction.options.getChannel('channel');

  const config = await getOrCreateConfig(guildId);

  switch (setting) {
    case 'xp-rate': {
      if (!value) {
        await interaction.reply({
          content: `Current XP rate: **${config.xpPerMessageMin}-${config.xpPerMessageMax}** per message.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      const parts = value.split('-').map(Number);
      if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
        await interaction.reply({
          content: 'Format: `min-max` (e.g. `15-25`)',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      const [min, max] = parts;
      if (min < 1 || max > 1000 || min > max) {
        await interaction.reply({
          content: xpLang.errors.invalidXpRange,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      config.xpPerMessageMin = min;
      config.xpPerMessageMax = max;
      break;
    }
    case 'cooldown': {
      if (!value) {
        await interaction.reply({
          content: `Current cooldown: **${config.xpCooldownSeconds}** seconds.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      const cooldown = Number(value);
      if (Number.isNaN(cooldown) || cooldown < 0 || cooldown > 3600) {
        await interaction.reply({
          content: xpLang.errors.invalidCooldown,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      config.xpCooldownSeconds = cooldown;
      break;
    }
    case 'voice-xp': {
      if (!value) {
        await interaction.reply({
          content: `Current voice XP: **${config.xpPerVoiceMinute}** per minute.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      const voiceXp = Number(value);
      if (Number.isNaN(voiceXp) || voiceXp < 0 || voiceXp > 100) {
        await interaction.reply({
          content: 'Voice XP must be between 0 and 100.',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      config.xpPerVoiceMinute = voiceXp;
      break;
    }
    case 'level-up-channel': {
      if (channel) {
        config.levelUpChannelId = channel.id;
      } else if (value === 'none' || value === 'clear') {
        config.levelUpChannelId = null;
      } else {
        await interaction.reply({
          content: `Current level-up channel: ${config.levelUpChannelId ? `<#${config.levelUpChannelId}>` : 'Same channel as message'}. Use the channel option or type \`none\` to clear.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      break;
    }
    case 'level-up-message': {
      if (!value) {
        await interaction.reply({
          content: `Current level-up message: ${config.levelUpMessage}\nPlaceholders: \`{user}\`, \`{level}\``,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      config.levelUpMessage = value;
      break;
    }
    case 'voice-xp-enabled': {
      if (!value) {
        await interaction.reply({
          content: `Voice XP is currently **${config.voiceXpEnabled ? 'enabled' : 'disabled'}**.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      config.voiceXpEnabled = value === 'true' || value === 'yes' || value === '1';
      break;
    }
    case 'stack-multipliers': {
      if (!value) {
        await interaction.reply({
          content: `Stack multipliers is currently **${config.stackMultipliers ? 'enabled' : 'disabled'}**.`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      config.stackMultipliers = value === 'true' || value === 'yes' || value === '1';
      break;
    }
    default:
      await interaction.reply({
        content: 'Unknown setting.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
  }

  await configRepo.save(config);
  invalidateXPConfigCache(guildId);
  await interaction.reply({
    content: xpLang.setup.configUpdated,
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleRoleRewardAdd(interaction: ChatInputCommandInteraction, guildId: string) {
  const level = interaction.options.getInteger('level', true);
  const role = interaction.options.getRole('role', true);
  const removeOnDelevel = interaction.options.getBoolean('remove-on-delevel') ?? false;

  // Check max rewards (25)
  const count = await rewardRepo.count({ where: { guildId } });
  if (count >= 25) {
    await interaction.reply({
      content: xpLang.errors.maxRoleRewards,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check for existing reward at this level
  const existing = await rewardRepo.findOne({ where: { guildId, level } });
  if (existing) {
    await interaction.reply({
      content: xpLang.setup.roleRewardExists.replace('{0}', String(level)),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const reward = rewardRepo.create({
    guildId,
    level,
    roleId: role.id,
    removeOnDelevel,
  });
  await rewardRepo.save(reward);

  enhancedLogger.info(
    `Role reward added: Level ${level} -> ${role.name} in guild ${guildId}`,
    LogCategory.COMMAND_EXECUTION,
  );

  await interaction.reply({
    content: xpLang.setup.roleRewardAdded.replace('{0}', String(level)).replace('{1}', role.id),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleRoleRewardRemove(interaction: ChatInputCommandInteraction, guildId: string) {
  const level = interaction.options.getInteger('level', true);
  const reward = await rewardRepo.findOne({ where: { guildId, level } });

  if (!reward) {
    await interaction.reply({
      content: xpLang.setup.roleRewardNotFound.replace('{0}', String(level)),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await rewardRepo.remove(reward);
  await interaction.reply({
    content: xpLang.setup.roleRewardRemoved.replace('{0}', String(level)),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleRoleRewardList(interaction: ChatInputCommandInteraction, guildId: string) {
  const rewards = await rewardRepo.find({
    where: { guildId },
    order: { level: 'ASC' },
  });

  if (rewards.length === 0) {
    await interaction.reply({
      content: xpLang.setup.roleRewardListEmpty,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const lines = rewards.map(
    r => `Level **${r.level}** — <@&${r.roleId}>${r.removeOnDelevel ? ' (removes on de-level)' : ''}`,
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.status.info)
    .setTitle(xpLang.setup.roleRewardListTitle)
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

async function handleIgnoreChannelAdd(interaction: ChatInputCommandInteraction, guildId: string) {
  const channel = interaction.options.getChannel('channel', true);
  const config = await getOrCreateConfig(guildId);

  const ignored = config.ignoredChannels || [];
  if (ignored.includes(channel.id)) {
    await interaction.reply({
      content: xpLang.setup.channelAlreadyIgnored.replace('{0}', `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  ignored.push(channel.id);
  config.ignoredChannels = ignored;
  await configRepo.save(config);
  invalidateXPConfigCache(guildId);

  await interaction.reply({
    content: xpLang.setup.channelIgnored.replace('{0}', `<#${channel.id}>`),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleIgnoreChannelRemove(interaction: ChatInputCommandInteraction, guildId: string) {
  const channel = interaction.options.getChannel('channel', true);
  const config = await getOrCreateConfig(guildId);

  const ignored = config.ignoredChannels || [];
  const index = ignored.indexOf(channel.id);
  if (index === -1) {
    await interaction.reply({
      content: xpLang.setup.channelNotIgnored.replace('{0}', `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  ignored.splice(index, 1);
  config.ignoredChannels = ignored.length > 0 ? ignored : null;
  await configRepo.save(config);
  invalidateXPConfigCache(guildId);

  await interaction.reply({
    content: xpLang.setup.channelUnignored.replace('{0}', `<#${channel.id}>`),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleMultiplierSet(interaction: ChatInputCommandInteraction, guildId: string) {
  const channel = interaction.options.getChannel('channel', true);
  const multiplier = interaction.options.getNumber('multiplier', true);

  const config = await getOrCreateConfig(guildId);
  const multipliers = config.multiplierChannels || {};
  multipliers[channel.id] = multiplier;
  config.multiplierChannels = multipliers;
  await configRepo.save(config);
  invalidateXPConfigCache(guildId);

  await interaction.reply({
    content: xpLang.setup.multiplierSet.replace('{0}', `<#${channel.id}>`).replace('{1}', String(multiplier)),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleMultiplierRemove(interaction: ChatInputCommandInteraction, guildId: string) {
  const channel = interaction.options.getChannel('channel', true);
  const config = await getOrCreateConfig(guildId);

  const multipliers = config.multiplierChannels || {};
  if (!(channel.id in multipliers)) {
    await interaction.reply({
      content: xpLang.setup.multiplierNotFound.replace('{0}', `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  delete multipliers[channel.id];
  config.multiplierChannels = Object.keys(multipliers).length > 0 ? multipliers : null;
  await configRepo.save(config);
  invalidateXPConfigCache(guildId);

  await interaction.reply({
    content: xpLang.setup.multiplierRemoved.replace('{0}', `<#${channel.id}>`),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleImportMee6(interaction: ChatInputCommandInteraction, _guildId: string) {
  // TODO: Bot Data Migration System (Plan 14) — call import manager when available
  // The import-mee6 subcommand should delegate to the import manager from src/utils/import/
  await interaction.reply({
    content: xpLang.setup.importPlaceholder,
    flags: [MessageFlags.Ephemeral],
  });
}
