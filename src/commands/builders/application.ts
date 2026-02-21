import {
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.application.position;
const tSC = lang.application.position.subcmdDescrp;

/* position subcommands */
const positionAdd = new SlashCommandSubcommandBuilder()
  .setName('add')
  .setDescription(tSC.add)
  .addStringOption(option =>
    option
      .setName('template')
      .setDescription(tSC['add-template'])
      .addChoices(
        { name: 'General Application', value: 'general' },
        { name: 'Staff Application', value: 'staff' },
        { name: 'Content Creator', value: 'content_creator' },
        { name: 'Developer Application', value: 'developer' },
        { name: 'Partnership Application', value: 'partnership' },
      ),
  )
  .addStringOption(option => option.setName('title').setDescription(tSC['add-title']))
  .addStringOption(option => option.setName('description').setDescription(tSC['add-description']))
  .addStringOption(option =>
    option.setName('emoji').setDescription(tSC['add-emoji']).setMaxLength(100),
  );

const positionRemove = new SlashCommandSubcommandBuilder()
  .setName('remove')
  .setDescription(tSC.remove)
  .addStringOption(option =>
    option
      .setName('position')
      .setDescription(tSC['remove-position'])
      .setRequired(true)
      .setAutocomplete(true),
  );

const positionToggle = new SlashCommandSubcommandBuilder()
  .setName('toggle')
  .setDescription(tSC.toggle)
  .addStringOption(option =>
    option
      .setName('position')
      .setDescription(tSC['toggle-position'])
      .setRequired(true)
      .setAutocomplete(true),
  );

const positionEdit = new SlashCommandSubcommandBuilder()
  .setName('edit')
  .setDescription(tSC.edit)
  .addStringOption(option =>
    option
      .setName('position')
      .setDescription(tSC['edit-position'])
      .setRequired(true)
      .setAutocomplete(true),
  );

const positionFields = new SlashCommandSubcommandBuilder()
  .setName('fields')
  .setDescription(tSC.fields)
  .addStringOption(option =>
    option
      .setName('position')
      .setDescription(tSC['fields-position'])
      .setRequired(true)
      .setAutocomplete(true),
  );

const positionList = new SlashCommandSubcommandBuilder().setName('list').setDescription(tSC.list);

const positionRefresh = new SlashCommandSubcommandBuilder()
  .setName('refresh')
  .setDescription(tSC.refresh);

const positionReindex = new SlashCommandSubcommandBuilder()
  .setName('reindex')
  .setDescription(tSC.reindex);

/* position subcommand group */
const positionGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('position')
  .setDescription(tl.cmdDescrp)
  .addSubcommand(positionAdd)
  .addSubcommand(positionRemove)
  .addSubcommand(positionToggle)
  .addSubcommand(positionEdit)
  .addSubcommand(positionFields)
  .addSubcommand(positionList)
  .addSubcommand(positionRefresh)
  .addSubcommand(positionReindex);

/* main slash command */
export const application = new SlashCommandBuilder()
  .setName('application')
  .setDescription('Manage application system')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommandGroup(positionGroup)
  .toJSON();
