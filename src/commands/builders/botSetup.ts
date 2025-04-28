import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import lang from '../../utils/lang.json';

/* main slash command */
export const botSetup = new SlashCommandBuilder()
    .setName('bot-setup')
    .setDescription(lang.botSetup.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();