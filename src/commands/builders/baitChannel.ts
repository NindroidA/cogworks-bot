import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.baitChannel.builder;

export const baitChannelCommand = new SlashCommandBuilder()
  .setName('baitchannel')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('setup')
      .setDescription(tl.setup.descrp)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.setup.channel)
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addIntegerOption(option =>
        option
          .setName('grace_period')
          .setDescription(tl.setup.gracePeriod)
          .setMinValue(0)
          .setMaxValue(60)
          .setRequired(true),
      )
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription(tl.setup.action)
          .addChoices(
            { name: tl.setup.actionBan, value: 'ban' },
            { name: tl.setup.actionKick, value: 'kick' },
            { name: tl.setup.actionTimeout, value: 'timeout' },
            { name: tl.setup.actionLogOnly, value: 'log-only' },
          )
          .setRequired(true),
      )
      .addChannelOption(option =>
        option
          .setName('log_channel')
          .setDescription(tl.setup.logChannel)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('detection')
      .setDescription(tl.detection.descrp)
      .addBooleanOption(option =>
        option.setName('enabled').setDescription(tl.detection.enabled).setRequired(true),
      )
      .addIntegerOption(option =>
        option
          .setName('min_account_age')
          .setDescription(tl.detection.minAccountAge)
          .setMinValue(0)
          .setMaxValue(365),
      )
      .addIntegerOption(option =>
        option
          .setName('min_membership')
          .setDescription(tl.detection.minMembership)
          .setMinValue(0)
          .setMaxValue(1440),
      )
      .addIntegerOption(option =>
        option
          .setName('min_messages')
          .setDescription(tl.detection.minMessages)
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addBooleanOption(option =>
        option.setName('require_verification').setDescription(tl.detection.requireVerification),
      )
      .addBooleanOption(option =>
        option
          .setName('disable_admin_whitelist')
          .setDescription(tl.detection.disableAdminWhitelist),
      )
      .addIntegerOption(option =>
        option
          .setName('threshold')
          .setDescription(tl.detection.threshold)
          .setMinValue(50)
          .setMaxValue(100),
      )
      .addIntegerOption(option =>
        option
          .setName('join_velocity_threshold')
          .setDescription(tl.detection.joinVelocityThreshold)
          .setMinValue(2)
          .setMaxValue(100),
      )
      .addIntegerOption(option =>
        option
          .setName('join_velocity_window')
          .setDescription(tl.detection.joinVelocityWindow)
          .setMinValue(1)
          .setMaxValue(30),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('whitelist')
      .setDescription(tl.whitelist.descrp)
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription(tl.whitelist.action)
          .addChoices(
            { name: tl.whitelist.actionAdd, value: 'add' },
            { name: tl.whitelist.actionRemove, value: 'remove' },
            { name: tl.whitelist.actionList, value: 'list' },
          )
          .setRequired(true),
      )
      .addRoleOption(option => option.setName('role').setDescription(tl.whitelist.role))
      .addUserOption(option => option.setName('user').setDescription(tl.whitelist.user)),
  )
  .addSubcommand(subcommand => subcommand.setName('status').setDescription(tl.status.descrp))
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription(tl.stats.descrp)
      .addIntegerOption(option =>
        option.setName('days').setDescription(tl.stats.days).setMinValue(1).setMaxValue(90),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('toggle')
      .setDescription(tl.toggle.descrp)
      .addBooleanOption(option =>
        option.setName('enabled').setDescription(tl.toggle.enabled).setRequired(true),
      ),
  )
  // Escalation subcommands
  .addSubcommand(subcommand =>
    subcommand.setName('escalation-enable').setDescription(tl.escalation.enableDescrp),
  )
  .addSubcommand(subcommand =>
    subcommand.setName('escalation-disable').setDescription(tl.escalation.disableDescrp),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('escalation-thresholds')
      .setDescription(tl.escalation.thresholdsDescrp)
      .addIntegerOption(option =>
        option
          .setName('log')
          .setDescription(tl.escalation.logOption)
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addIntegerOption(option =>
        option
          .setName('timeout')
          .setDescription(tl.escalation.timeoutOption)
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addIntegerOption(option =>
        option
          .setName('kick')
          .setDescription(tl.escalation.kickOption)
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addIntegerOption(option =>
        option
          .setName('ban')
          .setDescription(tl.escalation.banOption)
          .setMinValue(0)
          .setMaxValue(100),
      ),
  )
  // DM notification subcommands
  .addSubcommand(subcommand =>
    subcommand.setName('dm-enable').setDescription(tl.dmNotify.enableDescrp),
  )
  .addSubcommand(subcommand =>
    subcommand.setName('dm-disable').setDescription(tl.dmNotify.disableDescrp),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('dm-appeal-info')
      .setDescription(tl.dmNotify.appealDescrp)
      .addStringOption(option =>
        option
          .setName('text')
          .setDescription(tl.dmNotify.appealTextOption)
          .setRequired(true)
          .setMaxLength(500),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand.setName('dm-clear-appeal').setDescription(tl.dmNotify.clearAppealDescrp),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('keywords')
      .setDescription(tl.keywords.descrp)
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription(tl.keywords.action)
          .addChoices(
            { name: 'Add keyword', value: 'add' },
            { name: 'Remove keyword', value: 'remove' },
            { name: 'List keywords', value: 'list' },
            { name: 'Reset to defaults', value: 'reset' },
          )
          .setRequired(true),
      )
      .addStringOption(option =>
        option
          .setName('keyword')
          .setDescription(tl.keywords.keyword)
          .setMaxLength(100)
          .setAutocomplete(true),
      )
      .addIntegerOption(option =>
        option.setName('weight').setDescription(tl.keywords.weight).setMinValue(1).setMaxValue(10),
      ),
  );
