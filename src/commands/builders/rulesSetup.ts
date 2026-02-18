import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.rules.builder;

const setup = new SlashCommandSubcommandBuilder()
  .setName('setup')
  .setDescription(tl.setup.descrp)
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription(tl.setup.channel)
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText),
  )
  .addRoleOption(option => option.setName('role').setDescription(tl.setup.role).setRequired(true))
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription(tl.setup.message)
      .setRequired(false)
      .setMaxLength(1800),
  )
  .addStringOption(option =>
    option.setName('emoji').setDescription(tl.setup.emoji).setRequired(false),
  );

const view = new SlashCommandSubcommandBuilder().setName('view').setDescription(tl.view.descrp);

const remove = new SlashCommandSubcommandBuilder()
  .setName('remove')
  .setDescription(tl.remove.descrp);

export const rulesSetup = new SlashCommandBuilder()
  .setName('rules-setup')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(setup)
  .addSubcommand(view)
  .addSubcommand(remove)
  .toJSON();
