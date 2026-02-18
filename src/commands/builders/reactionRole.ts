import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.reactionRole.builder;

const create = new SlashCommandSubcommandBuilder()
  .setName('create')
  .setDescription(tl.create.descrp)
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription(tl.create.channel)
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText),
  )
  .addStringOption(option =>
    option.setName('name').setDescription(tl.create.name).setRequired(true).setMaxLength(255),
  )
  .addStringOption(option =>
    option
      .setName('description')
      .setDescription(tl.create.description)
      .setRequired(false)
      .setMaxLength(4000),
  )
  .addStringOption(option =>
    option
      .setName('mode')
      .setDescription(tl.create.mode)
      .setRequired(false)
      .addChoices(
        { name: 'Normal (select multiple)', value: 'normal' },
        { name: 'Unique (one at a time)', value: 'unique' },
        { name: 'Lock (cannot remove)', value: 'lock' },
      ),
  );

const add = new SlashCommandSubcommandBuilder()
  .setName('add')
  .setDescription(tl.add.descrp)
  .addStringOption(option =>
    option.setName('menu').setDescription(tl.add.menuId).setRequired(true).setAutocomplete(true),
  )
  .addStringOption(option =>
    option.setName('emoji').setDescription(tl.add.emoji).setRequired(true).setMaxLength(64),
  )
  .addRoleOption(option => option.setName('role').setDescription(tl.add.role).setRequired(true))
  .addStringOption(option =>
    option
      .setName('description')
      .setDescription(tl.add.description)
      .setRequired(false)
      .setMaxLength(200),
  );

const remove = new SlashCommandSubcommandBuilder()
  .setName('remove')
  .setDescription(tl.remove.descrp)
  .addStringOption(option =>
    option.setName('menu').setDescription(tl.remove.menuId).setRequired(true).setAutocomplete(true),
  )
  .addStringOption(option =>
    option.setName('emoji').setDescription(tl.remove.emoji).setRequired(true),
  );

const edit = new SlashCommandSubcommandBuilder()
  .setName('edit')
  .setDescription(tl.edit.descrp)
  .addStringOption(option =>
    option.setName('menu').setDescription(tl.edit.menuId).setRequired(true).setAutocomplete(true),
  )
  .addStringOption(option =>
    option.setName('name').setDescription(tl.edit.name).setRequired(false).setMaxLength(255),
  )
  .addStringOption(option =>
    option
      .setName('description')
      .setDescription(tl.edit.description)
      .setRequired(false)
      .setMaxLength(4000),
  )
  .addStringOption(option =>
    option
      .setName('mode')
      .setDescription(tl.edit.mode)
      .setRequired(false)
      .addChoices(
        { name: 'Normal (select multiple)', value: 'normal' },
        { name: 'Unique (one at a time)', value: 'unique' },
        { name: 'Lock (cannot remove)', value: 'lock' },
      ),
  );

const deleteMenu = new SlashCommandSubcommandBuilder()
  .setName('delete')
  .setDescription(tl.delete.descrp)
  .addStringOption(option =>
    option.setName('menu').setDescription(tl.delete.menuId).setRequired(true).setAutocomplete(true),
  );

const list = new SlashCommandSubcommandBuilder().setName('list').setDescription(tl.list.descrp);

export const reactionRole = new SlashCommandBuilder()
  .setName('reactionrole')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(create)
  .addSubcommand(add)
  .addSubcommand(remove)
  .addSubcommand(edit)
  .addSubcommand(deleteMenu)
  .addSubcommand(list)
  .toJSON();
