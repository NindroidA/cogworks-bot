import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import lang from "../../utils/lang.json";

/* subcommands */
const staff = new SlashCommandSubcommandBuilder()
    .setName('staff')
    .setDescription(lang.removeRole.subcmdDescrp.staff)
    .addRoleOption((option) => option
        .setName('role_id')
        .setDescription(lang.removeRole.subcmdDescrp.roleid)
        .setRequired(true)
    );

const admin = new SlashCommandSubcommandBuilder()
    .setName('admin')
    .setDescription(lang.removeRole.subcmdDescrp.admin)
    .addRoleOption((option) => option
        .setName('role_id')
        .setDescription(lang.removeRole.subcmdDescrp.roleid)
        .setRequired(true)
    );

/* main slash command */
export const removeRole = new SlashCommandBuilder()
    .setName('remove-role')
    .setDescription(lang.removeRole.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(staff)
    .addSubcommand(admin)
    .toJSON();
