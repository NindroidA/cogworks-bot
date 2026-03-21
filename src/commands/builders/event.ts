import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';

import eventLang from '../../lang/event.json';

const tl = eventLang.builder;

/* =========================================================================
 * Create subcommand
 * ========================================================================= */

const create = new SlashCommandSubcommandBuilder()
  .setName('create')
  .setDescription(tl.create.descrp)
  .addStringOption(option =>
    option.setName('title').setDescription(tl.create.title).setRequired(true).setMaxLength(100),
  )
  .addStringOption(option =>
    option
      .setName('start')
      .setDescription(tl.create.start)
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(22),
  )
  .addStringOption(option =>
    option
      .setName('description')
      .setDescription(tl.create.description)
      .setRequired(false)
      .setMaxLength(1000),
  )
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription(tl.create.channel)
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
  )
  .addIntegerOption(option =>
    option
      .setName('duration')
      .setDescription(tl.create.duration)
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(1440),
  )
  .addStringOption(option =>
    option
      .setName('location')
      .setDescription(tl.create.location)
      .setRequired(false)
      .setMaxLength(100),
  );

/* =========================================================================
 * From-template subcommand
 * ========================================================================= */

const fromTemplate = new SlashCommandSubcommandBuilder()
  .setName('from-template')
  .setDescription(tl.fromTemplate.descrp)
  .addStringOption(option =>
    option
      .setName('template')
      .setDescription(tl.fromTemplate.template)
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption(option =>
    option
      .setName('start')
      .setDescription(tl.fromTemplate.start)
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(22),
  );

/* =========================================================================
 * Cancel subcommand
 * ========================================================================= */

const cancel = new SlashCommandSubcommandBuilder()
  .setName('cancel')
  .setDescription(tl.cancel.descrp)
  .addStringOption(option =>
    option.setName('event').setDescription(tl.cancel.event).setRequired(true).setAutocomplete(true),
  );

/* =========================================================================
 * Remind subcommand
 * ========================================================================= */

const remind = new SlashCommandSubcommandBuilder()
  .setName('remind')
  .setDescription(tl.remind.descrp)
  .addStringOption(option =>
    option.setName('event').setDescription(tl.remind.event).setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption(option =>
    option
      .setName('minutes')
      .setDescription(tl.remind.minutes)
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(10080),
  );

/* =========================================================================
 * Template subcommand group
 * ========================================================================= */

const templateGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('template')
  .setDescription(tl.template.descrp)
  .addSubcommand(sub => sub.setName('create').setDescription(tl.template.create))
  .addSubcommand(sub =>
    sub
      .setName('edit')
      .setDescription(tl.template.edit)
      .addStringOption(option =>
        option
          .setName('template')
          .setDescription(tl.template.templateOption)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('delete')
      .setDescription(tl.template.delete)
      .addStringOption(option =>
        option
          .setName('template')
          .setDescription(tl.template.templateOption)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub => sub.setName('list').setDescription(tl.template.list));

/* =========================================================================
 * Setup subcommand group
 * ========================================================================= */

const setupGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('setup')
  .setDescription(tl.setup.descrp)
  .addSubcommand(sub => sub.setName('enable').setDescription(tl.setup.enable))
  .addSubcommand(sub => sub.setName('disable').setDescription(tl.setup.disable))
  .addSubcommand(sub =>
    sub
      .setName('reminder-channel')
      .setDescription(tl.setup.reminderChannel)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.setup.channelOption)
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('summary-channel')
      .setDescription(tl.setup.summaryChannel)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(tl.setup.channelOption)
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('default-reminder')
      .setDescription(tl.setup.defaultReminder)
      .addIntegerOption(option =>
        option
          .setName('minutes')
          .setDescription(tl.setup.minutesOption)
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(10080),
      ),
  );

/* =========================================================================
 * Recurring subcommand
 * ========================================================================= */

const recurring = new SlashCommandSubcommandBuilder()
  .setName('recurring')
  .setDescription(tl.recurring.descrp)
  .addStringOption(option =>
    option
      .setName('template')
      .setDescription(tl.recurring.template)
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption(option =>
    option
      .setName('start')
      .setDescription(tl.recurring.start)
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(22),
  )
  .addStringOption(option =>
    option
      .setName('pattern')
      .setDescription(tl.recurring.pattern)
      .setRequired(true)
      .addChoices(
        { name: 'Daily', value: 'daily' },
        { name: 'Weekly', value: 'weekly' },
        { name: 'Biweekly', value: 'biweekly' },
        { name: 'Monthly', value: 'monthly' },
      ),
  );

/* =========================================================================
 * Main slash command
 * ========================================================================= */

export const event = new SlashCommandBuilder()
  .setName('event')
  .setDescription(eventLang.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommandGroup(templateGroup)
  .addSubcommandGroup(setupGroup)
  .addSubcommand(create)
  .addSubcommand(fromTemplate)
  .addSubcommand(cancel)
  .addSubcommand(remind)
  .addSubcommand(recurring)
  .toJSON();
