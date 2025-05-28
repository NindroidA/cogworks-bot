import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import lang from '../../utils/lang.json';

/* main slash command */
export const getRoles = new SlashCommandBuilder()
    .setName('get-roles')
    .setDescription(lang.getRoles.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();
