import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import xpLang from '../../../lang/en/xp.json';
import { XPConfig } from '../../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import {
  createToggleHandler,
  enhancedLogger,
  handleInteractionError,
  LogCategory,
  replyEphemeralError,
} from '../../../utils';
import { Colors } from '../../../utils/colors';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { invalidateXPConfigCache } from '../../../utils/xp/configCache';

const configRepo = lazyRepo(XPConfig);
const rewardRepo = lazyRepo(XPRoleReward);

const xpToggle = createToggleHandler({
  repo: configRepo,
  field: 'enabled',
  messages: {
    alreadyEnabled: xpLang.setup.alreadyEnabled,
    alreadyDisabled: xpLang.setup.alreadyDisabled,
    enabled: xpLang.setup.enabled,
    disabled: xpLang.setup.disabled,
  },
  onToggled: (_interaction, guildId, enabled) => {
    invalidateXPConfigCache(guildId);
    enhancedLogger.info(
      `XP system ${enabled ? 'enabled' : 'disabled'} for guild ${guildId}`,
      LogCategory.COMMAND_EXECUTION,
    );
  },
});

export async function xpSetupHandler(_client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'enable':
        await xpToggle.enable(interaction, guildId);
        break;
      case 'disable':
        await xpToggle.disable(interaction, guildId);
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
      default:
        await replyEphemeralError(interaction, 'Unknown subcommand.');
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute XP setup command');
  }
}

async function getOrCreateConfig(guildId: string): Promise<XPConfig> {
  let config = await configRepo.findOne({ where: { guildId } });
  if (!config) {
    config = configRepo.create({ guildId });
    config = await configRepo.save(config);
  }
  return config;
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
        await replyEphemeralError(interaction, 'Format: `min-max` (e.g. `15-25`)');
        return;
      }
      const [min, max] = parts;
      if (min < 1 || max > 1000 || min > max) {
        await replyEphemeralError(interaction, xpLang.errors.invalidXpRange);
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
        await replyEphemeralError(interaction, xpLang.errors.invalidCooldown);
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
        await replyEphemeralError(interaction, 'Voice XP must be between 0 and 100.');
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
      await replyEphemeralError(interaction, 'Unknown setting.');
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
    await replyEphemeralError(interaction, xpLang.errors.maxRoleRewards);
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
