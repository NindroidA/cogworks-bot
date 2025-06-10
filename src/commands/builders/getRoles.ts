import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.getRoles;

/* main slash command */
export const getRoles = new SlashCommandBuilder()
    .setName('get-roles')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();
