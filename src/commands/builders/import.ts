/**
 * Import Command Builder
 *
 * /import mee6 xp [overwrite] [dry-run]
 * /import csv <attachment> [overwrite] [dry-run]
 * /import status
 * /import history
 * /import cancel
 */

import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.import.commands;

const mee6 = new SlashCommandSubcommandBuilder()
  .setName('mee6')
  .setDescription(tl.mee6Descrp)
  .addBooleanOption(option => option.setName('overwrite').setDescription(tl.overwriteOption).setRequired(false))
  .addBooleanOption(option => option.setName('dry-run').setDescription(tl.dryRunOption).setRequired(false));

const csv = new SlashCommandSubcommandBuilder()
  .setName('csv')
  .setDescription(tl.csvDescrp)
  .addAttachmentOption(option => option.setName('file').setDescription(tl.attachmentOption).setRequired(true))
  .addBooleanOption(option => option.setName('overwrite').setDescription(tl.overwriteOption).setRequired(false))
  .addBooleanOption(option => option.setName('dry-run').setDescription(tl.dryRunOption).setRequired(false));

const importStatus = new SlashCommandSubcommandBuilder().setName('status').setDescription(tl.statusDescrp);

const history = new SlashCommandSubcommandBuilder().setName('history').setDescription(tl.historyDescrp);

const cancel = new SlashCommandSubcommandBuilder().setName('cancel').setDescription(tl.cancelDescrp);

export const importCommand = new SlashCommandBuilder()
  .setName('import')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(mee6)
  .addSubcommand(csv)
  .addSubcommand(importStatus)
  .addSubcommand(history)
  .addSubcommand(cancel)
  .toJSON();
