import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';

/**
 * /xp-setup — Configure the XP & leveling system
 *
 * Subcommands:
 *   enable / disable
 *   config <setting> <value>
 *   role-reward add/remove/list
 *   ignore-channel add/remove
 *   multiplier set/remove
 *   import mee6
 */
export const xpSetup = new SlashCommandBuilder()
  .setName('xp-setup')
  .setDescription('Configure the XP & leveling system')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  // enable / disable
  .addSubcommand(sub => sub.setName('enable').setDescription('Enable the XP system'))
  .addSubcommand(sub => sub.setName('disable').setDescription('Disable the XP system'))
  // config
  .addSubcommand(sub =>
    sub
      .setName('config')
      .setDescription('Configure XP settings')
      .addStringOption(option =>
        option
          .setName('setting')
          .setDescription('The setting to configure')
          .setRequired(true)
          .addChoices(
            { name: 'XP Rate (min-max)', value: 'xp-rate' },
            { name: 'Cooldown (seconds)', value: 'cooldown' },
            { name: 'Voice XP (per minute)', value: 'voice-xp' },
            { name: 'Level-Up Channel', value: 'level-up-channel' },
            { name: 'Level-Up Message', value: 'level-up-message' },
            { name: 'Voice XP Enabled', value: 'voice-xp-enabled' },
            { name: 'Stack Multipliers', value: 'stack-multipliers' },
          ),
      )
      .addStringOption(option =>
        option.setName('value').setDescription('The new value for the setting').setRequired(false),
      )
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel (for level-up-channel setting)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  // role-reward add
  .addSubcommand(sub =>
    sub
      .setName('role-reward-add')
      .setDescription('Add a role reward for a level')
      .addIntegerOption(option =>
        option
          .setName('level')
          .setDescription('The level threshold for this reward')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1000),
      )
      .addRoleOption(option =>
        option.setName('role').setDescription('The role to grant at this level').setRequired(true),
      )
      .addBooleanOption(option =>
        option
          .setName('remove-on-delevel')
          .setDescription('Remove the role if user drops below this level')
          .setRequired(false),
      ),
  )
  // role-reward remove
  .addSubcommand(sub =>
    sub
      .setName('role-reward-remove')
      .setDescription('Remove a role reward')
      .addIntegerOption(option =>
        option
          .setName('level')
          .setDescription('The level to remove the reward from')
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  // role-reward list
  .addSubcommand(sub => sub.setName('role-reward-list').setDescription('List all role rewards'))
  // ignore-channel add/remove
  .addSubcommand(sub =>
    sub
      .setName('ignore-channel-add')
      .setDescription('Ignore a channel for XP')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to ignore')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('ignore-channel-remove')
      .setDescription('Stop ignoring a channel for XP')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to unignore')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
          .setRequired(true),
      ),
  )
  // multiplier set/remove
  .addSubcommand(sub =>
    sub
      .setName('multiplier-set')
      .setDescription('Set an XP multiplier for a channel')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to set a multiplier for')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
          .setRequired(true),
      )
      .addNumberOption(option =>
        option
          .setName('multiplier')
          .setDescription('Multiplier value (e.g. 1.5, 2, 0.5)')
          .setRequired(true)
          .setMinValue(0.1)
          .setMaxValue(10),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('multiplier-remove')
      .setDescription('Remove an XP multiplier from a channel')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to remove the multiplier from')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
          .setRequired(true),
      ),
  )
  // import mee6
  .addSubcommand(sub =>
    sub.setName('import-mee6').setDescription('Import XP data from MEE6 leaderboard'),
  )
  .toJSON();
