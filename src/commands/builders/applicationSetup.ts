import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.application.setup;

/* main slash command — all options are optional so admins can update individual settings */
export const applicationSetup = new SlashCommandBuilder()
  .setName('application-setup')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription(tl.options.channel)
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText),
  )
  .addChannelOption(option =>
    option
      .setName('archive')
      .setDescription(tl.options.archive)
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildForum),
  )
  .addChannelOption(option =>
    option
      .setName('category')
      .setDescription(tl.options.category)
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildCategory),
  )
  .toJSON();
