import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';
import { createActionOption, createTextChannelOption } from './factories';

const tl = lang.baitChannel.builder;

export const baitChannelCommand = new SlashCommandBuilder()
  .setName('baitchannel')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // ── setup group ──────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group
      .setName('setup')
      .setDescription('Set up and manage bait channel configuration')
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription(tl.setup.descrp)
          .addChannelOption(option =>
            createTextChannelOption(option, { description: tl.setup.channel, required: true }),
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
            createActionOption(option, {
              description: tl.setup.action,
              choices: [
                { name: tl.setup.actionBan, value: 'ban' },
                { name: tl.setup.actionKick, value: 'kick' },
                { name: tl.setup.actionTimeout, value: 'timeout' },
                { name: tl.setup.actionLogOnly, value: 'log-only' },
              ],
            }),
          )
          .addChannelOption(option =>
            createTextChannelOption(option, { name: 'log_channel', description: tl.setup.logChannel }),
          ),
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('toggle')
          .setDescription(tl.toggle.descrp)
          .addBooleanOption(option => option.setName('enabled').setDescription(tl.toggle.enabled).setRequired(true)),
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('add-channel')
          .setDescription(tl.addChannel.descrp)
          .addChannelOption(option =>
            createTextChannelOption(option, { description: tl.addChannel.channel, required: true }),
          ),
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove-channel')
          .setDescription(tl.removeChannel.descrp)
          .addChannelOption(option =>
            createTextChannelOption(option, { description: tl.removeChannel.channel, required: true }),
          ),
      )
      .addSubcommand(subcommand => subcommand.setName('status').setDescription(tl.status.descrp)),
  )

  // ── detection group ──────────────────────────────────────────
  .addSubcommandGroup(group =>
    group
      .setName('detection')
      .setDescription('Configure detection rules and filters')
      .addSubcommand(subcommand =>
        subcommand
          .setName('detection')
          .setDescription(tl.detection.descrp)
          .addBooleanOption(option => option.setName('enabled').setDescription(tl.detection.enabled).setRequired(true))
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
            option.setName('min_messages').setDescription(tl.detection.minMessages).setMinValue(0).setMaxValue(100),
          )
          .addBooleanOption(option =>
            option.setName('require_verification').setDescription(tl.detection.requireVerification),
          )
          .addBooleanOption(option =>
            option.setName('disable_admin_whitelist').setDescription(tl.detection.disableAdminWhitelist),
          )
          .addIntegerOption(option =>
            option.setName('threshold').setDescription(tl.detection.threshold).setMinValue(50).setMaxValue(100),
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
            createActionOption(option, {
              description: tl.whitelist.action,
              choices: [
                { name: tl.whitelist.actionAdd, value: 'add' },
                { name: tl.whitelist.actionRemove, value: 'remove' },
                { name: tl.whitelist.actionList, value: 'list' },
              ],
            }),
          )
          .addRoleOption(option => option.setName('role').setDescription(tl.whitelist.role))
          .addUserOption(option => option.setName('user').setDescription(tl.whitelist.user)),
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('keywords')
          .setDescription(tl.keywords.descrp)
          .addStringOption(option =>
            createActionOption(option, {
              description: tl.keywords.action,
              choices: [
                { name: 'Add keyword', value: 'add' },
                { name: 'Remove keyword', value: 'remove' },
                { name: 'List keywords', value: 'list' },
                { name: 'Reset to defaults', value: 'reset' },
              ],
            }),
          )
          .addStringOption(option =>
            option.setName('keyword').setDescription(tl.keywords.keyword).setMaxLength(100).setAutocomplete(true),
          )
          .addIntegerOption(option =>
            option.setName('weight').setDescription(tl.keywords.weight).setMinValue(1).setMaxValue(10),
          ),
      )
      .addSubcommand(subcommand => subcommand.setName('settings').setDescription(tl.settings.descrp))
      .addSubcommand(subcommand =>
        subcommand
          .setName('test-mode')
          .setDescription(tl.testMode.descrp)
          .addBooleanOption(option => option.setName('enabled').setDescription(tl.testMode.enabled).setRequired(true)),
      ),
  )

  // ── escalation group ─────────────────────────────────────────
  .addSubcommandGroup(group =>
    group
      .setName('escalation')
      .setDescription('Score-based action escalation settings')
      .addSubcommand(subcommand => subcommand.setName('enable').setDescription(tl.escalation.enableDescrp))
      .addSubcommand(subcommand => subcommand.setName('disable').setDescription(tl.escalation.disableDescrp))
      .addSubcommand(subcommand =>
        subcommand
          .setName('thresholds')
          .setDescription(tl.escalation.thresholdsDescrp)
          .addIntegerOption(option =>
            option.setName('log').setDescription(tl.escalation.logOption).setMinValue(0).setMaxValue(100),
          )
          .addIntegerOption(option =>
            option.setName('timeout').setDescription(tl.escalation.timeoutOption).setMinValue(0).setMaxValue(100),
          )
          .addIntegerOption(option =>
            option.setName('kick').setDescription(tl.escalation.kickOption).setMinValue(0).setMaxValue(100),
          )
          .addIntegerOption(option =>
            option.setName('ban').setDescription(tl.escalation.banOption).setMinValue(0).setMaxValue(100),
          ),
      ),
  )

  // ── dm group ─────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group
      .setName('dm')
      .setDescription('DM notification settings before action')
      .addSubcommand(subcommand => subcommand.setName('enable').setDescription(tl.dmNotify.enableDescrp))
      .addSubcommand(subcommand => subcommand.setName('disable').setDescription(tl.dmNotify.disableDescrp))
      .addSubcommand(subcommand =>
        subcommand
          .setName('appeal-info')
          .setDescription(tl.dmNotify.appealDescrp)
          .addStringOption(option =>
            option.setName('text').setDescription(tl.dmNotify.appealTextOption).setRequired(true).setMaxLength(500),
          ),
      )
      .addSubcommand(subcommand => subcommand.setName('clear-appeal').setDescription(tl.dmNotify.clearAppealDescrp)),
  )

  // ── stats group ──────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group
      .setName('stats')
      .setDescription('View statistics and manage detections')
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
          .setName('summary')
          .setDescription(tl.summary.descrp)
          .addBooleanOption(option => option.setName('enabled').setDescription(tl.summary.enabled).setRequired(true))
          .addChannelOption(option => createTextChannelOption(option, { description: tl.summary.channel })),
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('override')
          .setDescription(tl.override.descrp)
          .addUserOption(option => option.setName('user').setDescription(tl.override.user).setRequired(true)),
      ),
  )

  // ── raid group (v3.2.0) ──────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group
      .setName('raid')
      .setDescription('Raid mode — sticky guild lockdown when bait actions stack rapidly')
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('Show current raid mode status (active / threshold / recent triggers)'),
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('enter')
          .setDescription('Manually enter raid mode (sticky until released or 4h cap elapses)')
          .addStringOption(option =>
            option.setName('reason').setDescription('Optional context shown in the mod-alert embed').setMaxLength(200),
          ),
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('release')
          .setDescription('Release raid mode and restore @everyone send permissions on non-staff channels'),
      ),
  );
