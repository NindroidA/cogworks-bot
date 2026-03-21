import {
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.ticket.customTypes;

/* subcommands */
const typeAdd = new SlashCommandSubcommandBuilder()
  .setName('type-add')
  .setDescription(tl.typeAdd.cmdDescrp);

const typeEdit = new SlashCommandSubcommandBuilder()
  .setName('type-edit')
  .setDescription(tl.typeEdit.cmdDescrp)
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription(tl.typeEdit.optionDescrp)
      .setRequired(true)
      .setAutocomplete(true),
  );

const typeList = new SlashCommandSubcommandBuilder()
  .setName('type-list')
  .setDescription(tl.typeList.cmdDescrp);

const typeToggle = new SlashCommandSubcommandBuilder()
  .setName('type-toggle')
  .setDescription(tl.typeToggle.cmdDescrp)
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription(tl.typeToggle.optionDescrp)
      .setRequired(true)
      .setAutocomplete(true),
  );

const typeDefault = new SlashCommandSubcommandBuilder()
  .setName('type-default')
  .setDescription(tl.typeDefault.cmdDescrp)
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription(tl.typeDefault.optionDescrp)
      .setRequired(true)
      .setAutocomplete(true),
  );

const typeRemove = new SlashCommandSubcommandBuilder()
  .setName('type-remove')
  .setDescription(tl.typeRemove.cmdDescrp)
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription(tl.typeRemove.optionDescrp)
      .setRequired(true)
      .setAutocomplete(true),
  );

const typeFields = new SlashCommandSubcommandBuilder()
  .setName('type-fields')
  .setDescription('Configure custom input fields for a ticket type')
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription('Select the ticket type to configure')
      .setRequired(true)
      .setAutocomplete(true),
  );

const emailImport = new SlashCommandSubcommandBuilder()
  .setName('import-email')
  .setDescription(tl.emailImport.cmdDescrp);

const userRestrict = new SlashCommandSubcommandBuilder()
  .setName('user-restrict')
  .setDescription(tl.userRestrict.cmdDescrp)
  .addUserOption(option =>
    option.setName('user').setDescription(tl.userRestrict.optionUser).setRequired(true),
  )
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription(tl.userRestrict.optionType)
      .setRequired(false)
      .setAutocomplete(true),
  );

const tlw = lang.ticket.builder;

const ticketStatus = new SlashCommandSubcommandBuilder()
  .setName('status')
  .setDescription(tlw.status.descrp)
  .addStringOption(option =>
    option
      .setName('status')
      .setDescription(tlw.status.statusOption)
      .setRequired(true)
      .setAutocomplete(true),
  );

const ticketAssign = new SlashCommandSubcommandBuilder()
  .setName('assign')
  .setDescription(tlw.assign.descrp)
  .addUserOption(option =>
    option.setName('user').setDescription(tlw.assign.userOption).setRequired(true),
  );

const ticketUnassign = new SlashCommandSubcommandBuilder()
  .setName('unassign')
  .setDescription(tlw.unassign.descrp);

const ticketInfo = new SlashCommandSubcommandBuilder()
  .setName('info')
  .setDescription(tlw.info.descrp);

const workflowEnable = new SlashCommandSubcommandBuilder()
  .setName('workflow-enable')
  .setDescription(tlw.workflowEnable);

const workflowDisable = new SlashCommandSubcommandBuilder()
  .setName('workflow-disable')
  .setDescription(tlw.workflowDisable);

const workflowStatusAdd = new SlashCommandSubcommandBuilder()
  .setName('workflow-add-status')
  .setDescription(tlw.statusAdd)
  .addStringOption(option =>
    option.setName('id').setDescription(tlw.statusIdOption).setRequired(true),
  )
  .addStringOption(option =>
    option.setName('label').setDescription(tlw.statusLabelOption).setRequired(true),
  )
  .addStringOption(option =>
    option.setName('emoji').setDescription(tlw.statusEmojiOption).setRequired(false),
  );

const workflowStatusRemove = new SlashCommandSubcommandBuilder()
  .setName('workflow-remove-status')
  .setDescription(tlw.statusRemove)
  .addStringOption(option =>
    option
      .setName('status')
      .setDescription(tlw.statusSelectOption)
      .setRequired(true)
      .setAutocomplete(true),
  );

const autoCloseEnable = new SlashCommandSubcommandBuilder()
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
    option
      .setName('status')
      .setDescription(tlw.autoCloseStatusOption)
      .setRequired(false)
      .setAutocomplete(true),
  );

const autoCloseDisable = new SlashCommandSubcommandBuilder()
  .setName('autoclose-disable')
  .setDescription(tlw.autoCloseDisable);

const tls = lang.ticket.settings;
const settings = new SlashCommandSubcommandBuilder()
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
  .addBooleanOption(option =>
    option.setName('enabled').setDescription(tls.enabledOption).setRequired(true),
  )
  .addStringOption(option =>
    option.setName('type').setDescription(tls.typeOption).setRequired(false).setAutocomplete(true),
  );

/* main slash command */
export const ticket = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage custom ticket types and import email tickets')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(typeAdd)
  .addSubcommand(typeEdit)
  .addSubcommand(typeList)
  .addSubcommand(typeToggle)
  .addSubcommand(typeDefault)
  .addSubcommand(typeRemove)
  .addSubcommand(typeFields)
  .addSubcommand(emailImport)
  .addSubcommand(userRestrict)
  .addSubcommand(settings)
  .addSubcommand(ticketStatus)
  .addSubcommand(ticketAssign)
  .addSubcommand(ticketUnassign)
  .addSubcommand(ticketInfo)
  .addSubcommand(workflowEnable)
  .addSubcommand(workflowDisable)
  .addSubcommand(workflowStatusAdd)
  .addSubcommand(workflowStatusRemove)
  .addSubcommand(autoCloseEnable)
  .addSubcommand(autoCloseDisable)
  .toJSON();
