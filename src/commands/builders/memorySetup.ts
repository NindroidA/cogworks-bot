import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../lang';
import { MAX } from '../../utils/constants';

const tl = lang.memory.setup;
const tb = lang.memory.setupBuilder;

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
  .addSubcommand(sub =>
    sub
      .setName('tag-add')
      .setDescription(tb.tagAdd)
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription(tb.tagName)
          .setRequired(true)
          .setMaxLength(MAX.MEMORY_TAG_NAME_LENGTH),
      )
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription(tb.tagType)
          .setRequired(true)
          .addChoices({ name: 'Category', value: 'category' }, { name: 'Status', value: 'status' }),
      )
      .addStringOption(option =>
        option.setName('emoji').setDescription(tb.tagEmoji).setRequired(false),
      )
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tb.channelOption)
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('tag-remove')
      .setDescription(tb.tagRemove)
      .addStringOption(option =>
        option.setName('tag').setDescription(tb.tagOption).setRequired(true).setAutocomplete(true),
      )
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tb.channelOption)
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('tag-edit')
      .setDescription(tb.tagEdit)
      .addStringOption(option =>
        option.setName('tag').setDescription(tb.tagOption).setRequired(true).setAutocomplete(true),
      )
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription(tb.tagNewName)
          .setRequired(false)
          .setMaxLength(MAX.MEMORY_TAG_NAME_LENGTH),
      )
      .addStringOption(option =>
        option.setName('emoji').setDescription(tb.tagEmoji).setRequired(false),
      )
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tb.channelOption)
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('tag-list')
      .setDescription(tb.tagList)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tb.channelOption)
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('tag-reset')
      .setDescription(tb.tagReset)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tb.channelOption)
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false),
      ),
  )
  .toJSON();
