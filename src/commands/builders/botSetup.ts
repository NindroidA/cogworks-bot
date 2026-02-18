import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.botSetup;

/* main slash command */
export const botSetup = new SlashCommandBuilder()
  .setName('bot-setup')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .toJSON();
