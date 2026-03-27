import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.memory.builder;

/* add subcommand */
const add = new SlashCommandSubcommandBuilder().setName('add').setDescription(tl.add.descrp);

/* capture subcommand */
const capture = new SlashCommandSubcommandBuilder()
  .setName('capture')
  .setDescription(tl.capture.descrp)
  .addStringOption(option => option.setName('message').setDescription(tl.capture.messageOption).setRequired(true));

/* update subcommand */
const update = new SlashCommandSubcommandBuilder().setName('update').setDescription(tl.update.descrp);

/* delete subcommand */
const deleteCmd = new SlashCommandSubcommandBuilder().setName('delete').setDescription(tl.delete.descrp);

/* update-status subcommand (quick update from anywhere) */
const updateStatus = new SlashCommandSubcommandBuilder()
  .setName('update-status')
  .setDescription(tl.updateStatus.descrp)
  .addStringOption(option =>
    option.setName('thread').setDescription(tl.updateStatus.threadOption).setRequired(true).setAutocomplete(true),
  )
  .addStringOption(option =>
    option.setName('status').setDescription(tl.updateStatus.statusOption).setRequired(true).setAutocomplete(true),
  );

/* update-tags subcommand (quick update from anywhere) */
const updateTags = new SlashCommandSubcommandBuilder()
  .setName('update-tags')
  .setDescription(tl.updateTags.descrp)
  .addStringOption(option =>
    option.setName('thread').setDescription(tl.updateTags.threadOption).setRequired(true).setAutocomplete(true),
  );

/* tags subcommand */
const tags = new SlashCommandSubcommandBuilder()
  .setName('tags')
  .setDescription(tl.tags.descrp)
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription(tl.tags.action)
      .setRequired(true)
      .addChoices(
        { name: tl.tags.actionAdd, value: 'add' },
        { name: tl.tags.actionEdit, value: 'edit' },
        { name: tl.tags.actionRemove, value: 'remove' },
        { name: tl.tags.actionList, value: 'list' },
      ),
  );

/* main slash command */
export const memory = new SlashCommandBuilder()
  .setName('memory')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(add)
  .addSubcommand(capture)
  .addSubcommand(update)
  .addSubcommand(updateStatus)
  .addSubcommand(updateTags)
  .addSubcommand(deleteCmd)
  .addSubcommand(tags)
  .toJSON();
