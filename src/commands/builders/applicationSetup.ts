import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';
import { createForumChannelOption, createTextChannelOption } from './factories';

const tl = lang.application.setup;

/* main slash command — all options are optional so admins can update individual settings */
export const applicationSetup = new SlashCommandBuilder()
  .setName('application-setup')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addChannelOption(option => createTextChannelOption(option, { description: tl.options.channel, required: false }))
  .addChannelOption(option =>
    createForumChannelOption(option, { name: 'archive', description: tl.options.archive, required: false }),
  )
  .addChannelOption(option =>
    option
      .setName('category')
      .setDescription(tl.options.category)
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildCategory),
  )
  .toJSON();
