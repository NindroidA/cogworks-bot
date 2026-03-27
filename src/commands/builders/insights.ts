import { PermissionFlagsBits, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import analyticsLang from '../../lang/analytics.json';

const tl = analyticsLang.builder;

const overview = new SlashCommandSubcommandBuilder().setName('overview').setDescription(tl.overview.descrp);

const growth = new SlashCommandSubcommandBuilder()
  .setName('growth')
  .setDescription(tl.growth.descrp)
  .addIntegerOption(option =>
    option.setName('days').setDescription(tl.growth.daysOption).setRequired(false).setMinValue(1).setMaxValue(90),
  );

const channels = new SlashCommandSubcommandBuilder()
  .setName('channels')
  .setDescription(tl.channels.descrp)
  .addIntegerOption(option =>
    option.setName('days').setDescription(tl.channels.daysOption).setRequired(false).setMinValue(1).setMaxValue(90),
  );

const hours = new SlashCommandSubcommandBuilder()
  .setName('hours')
  .setDescription(tl.hours.descrp)
  .addIntegerOption(option =>
    option.setName('days').setDescription(tl.hours.daysOption).setRequired(false).setMinValue(1).setMaxValue(90),
  );

const setup = new SlashCommandSubcommandBuilder()
  .setName('setup')
  .setDescription(tl.setup.descrp)
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription(tl.setup.action)
      .setRequired(true)
      .addChoices(
        { name: 'Enable', value: 'enable' },
        { name: 'Disable', value: 'disable' },
        { name: 'Set Digest Channel', value: 'channel' },
        { name: 'Set Digest Frequency', value: 'frequency' },
        { name: 'View Status', value: 'status' },
      ),
  )
  .addChannelOption(option => option.setName('channel').setDescription(tl.setup.channel).setRequired(false))
  .addStringOption(option =>
    option
      .setName('frequency')
      .setDescription(tl.setup.frequency)
      .setRequired(false)
      .addChoices(
        { name: 'Weekly', value: 'weekly' },
        { name: 'Monthly', value: 'monthly' },
        { name: 'Both', value: 'both' },
      ),
  )
  .addIntegerOption(option =>
    option.setName('day').setDescription(tl.setup.day).setRequired(false).setMinValue(0).setMaxValue(28),
  );

export const insights = new SlashCommandBuilder()
  .setName('insights')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(overview)
  .addSubcommand(growth)
  .addSubcommand(channels)
  .addSubcommand(hours)
  .addSubcommand(setup)
  .toJSON();
