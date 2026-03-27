import {
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.ticket.customTypes;
const tlw = lang.ticket.builder;
const tls = lang.ticket.settings;

/* ── type group ── */
const typeGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('type')
  .setDescription('Manage custom ticket types')
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('add').setDescription(tl.typeAdd.cmdDescrp))
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('edit')
      .setDescription(tl.typeEdit.cmdDescrp)
      .addStringOption(option =>
        option.setName('type').setDescription(tl.typeEdit.optionDescrp).setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('list').setDescription(tl.typeList.cmdDescrp))
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('toggle')
      .setDescription(tl.typeToggle.cmdDescrp)
      .addStringOption(option =>
        option.setName('type').setDescription(tl.typeToggle.optionDescrp).setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('default')
      .setDescription(tl.typeDefault.cmdDescrp)
      .addStringOption(option =>
        option.setName('type').setDescription(tl.typeDefault.optionDescrp).setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('remove')
      .setDescription(tl.typeRemove.cmdDescrp)
      .addStringOption(option =>
        option.setName('type').setDescription(tl.typeRemove.optionDescrp).setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('fields')
      .setDescription('Configure custom input fields for a ticket type')
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('Select the ticket type to configure')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

/* ── manage group ── */
const manageGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('manage')
  .setDescription('Ticket management actions')
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('status')
      .setDescription(tlw.status.descrp)
      .addStringOption(option =>
        option.setName('status').setDescription(tlw.status.statusOption).setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('assign')
      .setDescription(tlw.assign.descrp)
      .addUserOption(option => option.setName('user').setDescription(tlw.assign.userOption).setRequired(true)),
  )
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('unassign').setDescription(tlw.unassign.descrp))
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('info').setDescription(tlw.info.descrp))
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('import-email').setDescription(tl.emailImport.cmdDescrp))
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('user-restrict')
      .setDescription(tl.userRestrict.cmdDescrp)
      .addUserOption(option => option.setName('user').setDescription(tl.userRestrict.optionUser).setRequired(true))
      .addStringOption(option =>
        option.setName('type').setDescription(tl.userRestrict.optionType).setRequired(false).setAutocomplete(true),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('settings')
      .setDescription(tls.cmdDescrp)
      .addStringOption(option =>
        option
          .setName('setting')
          .setDescription(tls.settingOption)
          .setRequired(true)
          .addChoices(
            { name: 'Admin-Only Staff Mention', value: 'admin-only-mention' },
            { name: 'Ping Staff on Create', value: 'ping-on-create' },
          ),
      )
      .addBooleanOption(option => option.setName('enabled').setDescription(tls.enabledOption).setRequired(true))
      .addStringOption(option =>
        option.setName('type').setDescription(tls.typeOption).setRequired(false).setAutocomplete(true),
      ),
  );

/* ── workflow group ── */
const workflowGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('workflow')
  .setDescription('Ticket workflow configuration')
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('enable').setDescription(tlw.workflowEnable))
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('disable').setDescription(tlw.workflowDisable))
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('add-status')
      .setDescription(tlw.statusAdd)
      .addStringOption(option => option.setName('id').setDescription(tlw.statusIdOption).setRequired(true))
      .addStringOption(option => option.setName('label').setDescription(tlw.statusLabelOption).setRequired(true))
      .addStringOption(option => option.setName('emoji').setDescription(tlw.statusEmojiOption).setRequired(false)),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('remove-status')
      .setDescription(tlw.statusRemove)
      .addStringOption(option =>
        option.setName('status').setDescription(tlw.statusSelectOption).setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('settings')
      .setDescription('Open workflow settings modal (enable/disable workflow + auto-close)'),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('autoclose-enable')
      .setDescription(tlw.autoCloseEnable)
      .addIntegerOption(option =>
        option
          .setName('days')
          .setDescription(tlw.autoCloseDaysOption)
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(90),
      )
      .addIntegerOption(option =>
        option
          .setName('warning-hours')
          .setDescription(tlw.autoCloseWarningOption)
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(72),
      )
      .addStringOption(option =>
        option.setName('status').setDescription(tlw.autoCloseStatusOption).setRequired(false).setAutocomplete(true),
      ),
  )
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('autoclose-disable').setDescription(tlw.autoCloseDisable));

/* ── sla group ── */
const slaGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('sla')
  .setDescription('SLA tracking and configuration')
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('enable')
      .setDescription(tlw.slaEnable)
      .addIntegerOption(option =>
        option
          .setName('target-minutes')
          .setDescription(tlw.slaTargetOption)
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(1440),
      )
      .addChannelOption(option =>
        option.setName('breach-channel').setDescription(tlw.slaBreachChannelOption).setRequired(false),
      ),
  )
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('disable').setDescription(tlw.slaDisable))
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('per-type')
      .setDescription(tlw.slaPerType)
      .addStringOption(option =>
        option.setName('type').setDescription(tlw.slaTypeOption).setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption(option =>
        option
          .setName('minutes')
          .setDescription(tlw.slaMinutesOption)
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(1440),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('stats')
      .setDescription(tlw.slaStats)
      .addIntegerOption(option =>
        option.setName('days').setDescription(tlw.slaDaysOption).setRequired(false).setMinValue(1).setMaxValue(365),
      ),
  );

/* ── routing group ── */
const routingGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('routing')
  .setDescription('Smart ticket routing configuration')
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('enable').setDescription(tlw.routingEnable))
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('disable').setDescription(tlw.routingDisable))
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('rule-add')
      .setDescription(tlw.routingRuleAdd)
      .addStringOption(option =>
        option.setName('type').setDescription(tlw.routingTypeOption).setRequired(true).setAutocomplete(true),
      )
      .addRoleOption(option => option.setName('role').setDescription(tlw.routingRoleOption).setRequired(true))
      .addIntegerOption(option =>
        option
          .setName('max-open')
          .setDescription(tlw.routingMaxOpenOption)
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(50),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('rule-remove')
      .setDescription(tlw.routingRuleRemove)
      .addStringOption(option =>
        option.setName('type').setDescription(tlw.routingTypeOption).setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('strategy')
      .setDescription(tlw.routingStrategy)
      .addStringOption(option =>
        option
          .setName('strategy')
          .setDescription(tlw.routingStrategyOption)
          .setRequired(true)
          .addChoices(
            { name: 'Round Robin', value: 'round-robin' },
            { name: 'Least Load', value: 'least-load' },
            { name: 'Random', value: 'random' },
          ),
      ),
  )
  .addSubcommand(new SlashCommandSubcommandBuilder().setName('stats').setDescription(tlw.routingStats));

/* ── main slash command ── */
export const ticket = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage custom ticket types and import email tickets')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommandGroup(typeGroup)
  .addSubcommandGroup(manageGroup)
  .addSubcommandGroup(workflowGroup)
  .addSubcommandGroup(slaGroup)
  .addSubcommandGroup(routingGroup)
  .toJSON();
