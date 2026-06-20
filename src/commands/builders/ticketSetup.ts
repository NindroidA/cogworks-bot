import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';
import { createForumChannelOption, createTextChannelOption } from './factories';

const tl = lang.ticketSetup;

/* main slash command — all options are optional so admins can update individual settings */
export const ticketSetup = new SlashCommandBuilder()
  .setName('ticket-setup')
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
