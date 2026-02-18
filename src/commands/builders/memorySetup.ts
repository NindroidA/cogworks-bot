import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../lang';

const tl = lang.memory.setup;

export const memorySetup = new SlashCommandBuilder()
  .setName('memory-setup')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription(tl.channelOption)
      .addChannelTypes(ChannelType.GuildForum)
      .setRequired(false),
  )
  .toJSON();
