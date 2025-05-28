import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import lang from '../../utils/lang.json';

/* subcommands */
const staff = new SlashCommandSubcommandBuilder()
    .setName('staff')
    .setDescription(lang.addRole.subcmdDescrp.staff)
    .addRoleOption((option) => option
        .setName('role_id')
        .setDescription(lang.addRole.subcmdDescrp.roleid)
        .setRequired(true)
    )
    .addStringOption((option) => option
        .setName('alias')
        .setDescription(lang.addRole.subcmdDescrp.alias)
        .setRequired(true)
    );

const admin = new SlashCommandSubcommandBuilder()
    .setName('admin')
    .setDescription(lang.addRole.subcmdDescrp.admin)
    .addRoleOption((option) => option
        .setName('role_id')
        .setDescription(lang.addRole.subcmdDescrp.roleid)
        .setRequired(true)
    )
    .addStringOption((option) => option
        .setName('alias')
        .setDescription(lang.addRole.subcmdDescrp.alias)
        .setRequired(true)
    );

/* main slash command */
export const addRole = new SlashCommandBuilder()
    .setName('add-role')
    .setDescription(lang.addRole.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(staff)
    .addSubcommand(admin)
    .toJSON();
