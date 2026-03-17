import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../lang';

const tl = lang.memory.setup;

export const memorySetup = new SlashCommandBuilder()
  .setName('memory-setup')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(sub =>
    sub
      .setName('setup')
      .setDescription(tl.cmdDescrp)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.channelOption)
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false),
      )
      .addStringOption(option =>
        option
          .setName('channel-name')
          .setDescription(tl.channelNameOption)
          .setRequired(false)
          .setMaxLength(100),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('add-channel')
      .setDescription(tl.addChannelDescrp)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.channelOption)
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(true),
      )
      .addStringOption(option =>
        option
          .setName('channel-name')
          .setDescription(tl.channelNameOption)
          .setRequired(false)
          .setMaxLength(100),
      ),
  )
  .addSubcommand(sub => sub.setName('remove-channel').setDescription(tl.removeChannelDescrp))
  .addSubcommand(sub => sub.setName('view').setDescription(tl.viewTitle))
  .toJSON();
