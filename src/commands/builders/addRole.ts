import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.addRole;

/* subcommands */
const staff = new SlashCommandSubcommandBuilder()
    .setName('staff')
    .setDescription(tl.subcmdDescrp.staff)
    .addRoleOption((option) => option
        .setName('role_id')
        .setDescription(tl.subcmdDescrp.roleid)
        .setRequired(true)
    )
    .addStringOption((option) => option
        .setName('alias')
        .setDescription(tl.subcmdDescrp.alias)
        .setRequired(true)
    );

const admin = new SlashCommandSubcommandBuilder()
    .setName('admin')
    .setDescription(tl.subcmdDescrp.admin)
    .addRoleOption((option) => option
        .setName('role_id')
        .setDescription(tl.subcmdDescrp.roleid)
        .setRequired(true)
    )
    .addStringOption((option) => option
        .setName('alias')
        .setDescription(tl.subcmdDescrp.alias)
        .setRequired(true)
    );

/* main slash command */
export const addRole = new SlashCommandBuilder()
    .setName('add-role')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(staff)
    .addSubcommand(admin)
    .toJSON();
