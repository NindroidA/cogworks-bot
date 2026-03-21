import {
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.announcement;

/* =========================================================================
 * Legacy subcommands (backward compat)
 * ========================================================================= */

const maintenance = new SlashCommandSubcommandBuilder()
  .setName('maintenance')
  .setDescription(tl.maintenance.cmdDescrp)
  .addStringOption(option =>
    option
      .setName('duration')
      .setDescription(tl.maintenance.duration.cmdDescrp)
      .setRequired(true)
      .addChoices(
        { name: tl.maintenance.duration.short.name, value: tl.maintenance.duration.short.value },
        { name: tl.maintenance.duration.long.name, value: tl.maintenance.duration.long.value },
      ),
  )
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Custom message (overrides default)')
      .setRequired(false)
      .setMaxLength(2048),
  )
  .addChannelOption(option =>
    option.setName('channel').setDescription(tl.channel).setRequired(false),
  );

const maintenanceScheduled = new SlashCommandSubcommandBuilder()
  .setName('maintenance-scheduled')
  .setDescription(tl.maintenance.scheduled.cmdDescrp)
  .addStringOption(option =>
    option
      .setName('time')
      .setDescription(tl['update-scheduled'].time.cmdDescrp)
      .setRequired(true)
      .setMinLength(19)
      .setMaxLength(22),
  )
  .addStringOption(option =>
    option
      .setName('duration')
      .setDescription(tl.maintenance.duration.cmdDescrp)
      .setRequired(true)
      .addChoices(
        { name: tl.maintenance.duration.short.name, value: tl.maintenance.duration.short.value },
        { name: tl.maintenance.duration.long.name, value: tl.maintenance.duration.long.value },
      ),
  )
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Custom message (overrides default)')
      .setRequired(false)
      .setMaxLength(2048),
  )
  .addChannelOption(option =>
    option.setName('channel').setDescription(tl.channel).setRequired(false),
  );

const backOnline = new SlashCommandSubcommandBuilder()
  .setName('back-online')
  .setDescription(tl['back-online'].cmdDescrp)
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Custom message (overrides default)')
      .setRequired(false)
      .setMaxLength(2048),
  )
  .addChannelOption(option =>
    option.setName('channel').setDescription(tl.channel).setRequired(false),
  );

const updateScheduled = new SlashCommandSubcommandBuilder()
  .setName('update-scheduled')
  .setDescription(tl['update-scheduled'].cmdDescrp)
  .addStringOption(option =>
    option
      .setName('version')
      .setDescription(tl['update-scheduled'].version.cmdDescrp)
      .setRequired(true),
  )
  .addStringOption(option =>
    option
      .setName('time')
      .setDescription(tl['update-scheduled'].time.cmdDescrp)
      .setRequired(true)
      .setMinLength(19)
      .setMaxLength(22),
  )
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Custom message (overrides default)')
      .setRequired(false)
      .setMaxLength(2048),
  )
  .addChannelOption(option =>
    option.setName('channel').setDescription(tl.channel).setRequired(false),
  );

const updateComplete = new SlashCommandSubcommandBuilder()
  .setName('update-complete')
  .setDescription(tl['update-complete'].cmdDescrp)
  .addStringOption(option =>
    option
      .setName('version')
      .setDescription(tl['update-scheduled'].version.cmdDescrp)
      .setRequired(true),
  )
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Custom message (overrides default)')
      .setRequired(false)
      .setMaxLength(2048),
  )
  .addChannelOption(option =>
    option.setName('channel').setDescription(tl.channel).setRequired(false),
  );

/* =========================================================================
 * New send subcommand
 * ========================================================================= */

const send = new SlashCommandSubcommandBuilder()
  .setName('send')
  .setDescription('Send an announcement using a template')
  .addStringOption(option =>
    option
      .setName('template')
      .setDescription('Template to use')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addChannelOption(option =>
    option.setName('channel').setDescription(tl.channel).setRequired(false),
  )
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Custom message (overrides template body)')
      .setRequired(false)
      .setMaxLength(4000),
  );

/* =========================================================================
 * Template subcommand group
 * ========================================================================= */

const templateGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('template')
  .setDescription('Manage announcement templates')
  .addSubcommand(sub => sub.setName('create').setDescription('Create a new announcement template'))
  .addSubcommand(sub =>
    sub
      .setName('edit')
      .setDescription('Edit an existing template')
      .addStringOption(option =>
        option
          .setName('template')
          .setDescription('Template to edit')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('delete')
      .setDescription('Delete a custom template')
      .addStringOption(option =>
        option
          .setName('template')
          .setDescription('Template to delete')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub => sub.setName('list').setDescription('List all templates for this server'))
  .addSubcommand(sub =>
    sub
      .setName('preview')
      .setDescription('Preview a template with example values')
      .addStringOption(option =>
        option
          .setName('template')
          .setDescription('Template to preview')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub => sub.setName('reset').setDescription('Reset all templates to defaults'));

/* =========================================================================
 * Main slash command
 * ========================================================================= */

export const announcement = new SlashCommandBuilder()
  .setName('announcement')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommandGroup(templateGroup)
  .addSubcommand(send)
  .addSubcommand(maintenance)
  .addSubcommand(maintenanceScheduled)
  .addSubcommand(backOnline)
  .addSubcommand(updateScheduled)
  .addSubcommand(updateComplete)
  .toJSON();
