import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../lang';

const tl = lang.starboard.builder;

export const starboard = new SlashCommandBuilder()
  .setName('starboard')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(sub =>
    sub
      .setName('setup')
      .setDescription(tl.setup.descrp)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.setup.channel)
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption(option =>
        option.setName('emoji').setDescription(tl.setup.emoji).setRequired(false),
      )
      .addIntegerOption(option =>
        option
          .setName('threshold')
          .setDescription(tl.setup.threshold)
          .setMinValue(1)
          .setMaxValue(25)
          .setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('config')
      .setDescription(tl.config.descrp)
      .addStringOption(option =>
        option
          .setName('setting')
          .setDescription(tl.config.setting)
          .setRequired(true)
          .addChoices(
            { name: 'emoji', value: 'emoji' },
            { name: 'threshold', value: 'threshold' },
            { name: 'self-star', value: 'self-star' },
            { name: 'ignore-bots', value: 'ignore-bots' },
            { name: 'ignore-nsfw', value: 'ignore-nsfw' },
          ),
      )
      .addStringOption(option =>
        option.setName('value').setDescription(tl.config.value).setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('ignore')
      .setDescription(tl.ignore.descrp)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.ignore.channel)
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('unignore')
      .setDescription(tl.unignore.descrp)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.unignore.channel)
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand(sub => sub.setName('stats').setDescription(tl.stats.descrp))
  .addSubcommand(sub => sub.setName('toggle').setDescription(tl.toggle.descrp))
  .addSubcommand(sub => sub.setName('random').setDescription(tl.random.descrp))
  .toJSON();
