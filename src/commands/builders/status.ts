import { SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.status.builder;

const set = new SlashCommandSubcommandBuilder()
  .setName('set')
  .setDescription(tl.set.descrp)
  .addStringOption(option =>
    option
      .setName('level')
      .setDescription(tl.set.level)
      .setRequired(true)
      .addChoices(
        { name: 'Operational', value: 'operational' },
        { name: 'Degraded Performance', value: 'degraded' },
        { name: 'Partial Outage', value: 'partial-outage' },
        { name: 'Major Outage', value: 'major-outage' },
        { name: 'Scheduled Maintenance', value: 'maintenance' },
      ),
  )
  .addStringOption(option =>
    option.setName('message').setDescription(tl.set.message).setRequired(false),
  )
  .addStringOption(option =>
    option.setName('systems').setDescription(tl.set.systems).setRequired(false).setMaxLength(500),
  );

const clear = new SlashCommandSubcommandBuilder()
  .setName('clear')
  .setDescription(tl.clear.descrp)
  .addStringOption(option =>
    option.setName('message').setDescription(tl.clear.message).setRequired(false),
  );

const view = new SlashCommandSubcommandBuilder().setName('view').setDescription(tl.view.descrp);

export const status = new SlashCommandBuilder()
  .setName('status')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(0)
  .addSubcommand(set)
  .addSubcommand(clear)
  .addSubcommand(view)
  .toJSON();
