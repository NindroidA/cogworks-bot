import {
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tlAdd = lang.addRole;
const tlRemove = lang.removeRole;
const tlGet = lang.getRoles;

/* add subcommand group */
const addStaff = new SlashCommandSubcommandBuilder()
  .setName('staff')
  .setDescription(tlAdd.subcmdDescrp.staff)
  .addRoleOption(option =>
    option.setName('role_id').setDescription(tlAdd.subcmdDescrp.roleid).setRequired(true),
  )
  .addStringOption(option =>
    option.setName('alias').setDescription(tlAdd.subcmdDescrp.alias).setRequired(true),
  );

const addAdmin = new SlashCommandSubcommandBuilder()
  .setName('admin')
  .setDescription(tlAdd.subcmdDescrp.admin)
  .addRoleOption(option =>
    option.setName('role_id').setDescription(tlAdd.subcmdDescrp.roleid).setRequired(true),
  )
  .addStringOption(option =>
    option.setName('alias').setDescription(tlAdd.subcmdDescrp.alias).setRequired(true),
  );

const addGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('add')
  .setDescription(tlAdd.cmdDescrp)
  .addSubcommand(addStaff)
  .addSubcommand(addAdmin);

/* remove subcommand group */
const removeStaff = new SlashCommandSubcommandBuilder()
  .setName('staff')
  .setDescription(tlRemove.subcmdDescrp.staff)
  .addRoleOption(option =>
    option.setName('role_id').setDescription(tlRemove.subcmdDescrp.roleid).setRequired(true),
  );

const removeAdmin = new SlashCommandSubcommandBuilder()
  .setName('admin')
  .setDescription(tlRemove.subcmdDescrp.admin)
  .addRoleOption(option =>
    option.setName('role_id').setDescription(tlRemove.subcmdDescrp.roleid).setRequired(true),
  );

const removeGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('remove')
  .setDescription(tlRemove.cmdDescrp)
  .addSubcommand(removeStaff)
  .addSubcommand(removeAdmin);

/* list subcommand */
const list = new SlashCommandSubcommandBuilder().setName('list').setDescription(tlGet.cmdDescrp);

/* main slash command */
export const role = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Manage saved staff and admin roles')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommandGroup(addGroup)
  .addSubcommandGroup(removeGroup)
  .addSubcommand(list)
  .toJSON();
