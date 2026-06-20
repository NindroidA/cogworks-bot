import {
  PermissionsBitField,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.announcement;

/* =========================================================================
 * Timezone choices for time-based templates (the `timezone` option on `send`).
 * Values are IANA zone IDs, interpreted DST-aware by parseTimeInput().
 * ========================================================================= */
const TIMEZONE_CHOICES = [
  { name: 'UTC', value: 'UTC' },
  { name: 'US Eastern (ET)', value: 'America/New_York' },
  { name: 'US Central (CT)', value: 'America/Chicago' },
  { name: 'US Mountain (MT)', value: 'America/Denver' },
  { name: 'US Arizona (no DST)', value: 'America/Phoenix' },
  { name: 'US Pacific (PT)', value: 'America/Los_Angeles' },
  { name: 'US Alaska (AKT)', value: 'America/Anchorage' },
  { name: 'US Hawaii (HST)', value: 'Pacific/Honolulu' },
  { name: 'Brazil (BRT)', value: 'America/Sao_Paulo' },
  { name: 'UK (GMT/BST)', value: 'Europe/London' },
  { name: 'Central Europe (CET)', value: 'Europe/Paris' },
  { name: 'Eastern Europe (EET)', value: 'Europe/Athens' },
  { name: 'Moscow (MSK)', value: 'Europe/Moscow' },
  { name: 'India (IST)', value: 'Asia/Kolkata' },
  { name: 'China (CST)', value: 'Asia/Shanghai' },
  { name: 'Japan (JST)', value: 'Asia/Tokyo' },
  { name: 'Sydney (AET)', value: 'Australia/Sydney' },
  { name: 'New Zealand (NZT)', value: 'Pacific/Auckland' },
];

/* =========================================================================
 * Send subcommand — the single entry point for sending an announcement.
 * Replaces the former per-type legacy subcommands (maintenance, back-online,
 * update-scheduled, …); each of those is now simply a template selected here.
 * ========================================================================= */
const send = new SlashCommandSubcommandBuilder()
  .setName('send')
  .setDescription('Send an announcement using a template')
  .addStringOption(option =>
    option.setName('template').setDescription('Template to use').setRequired(true).setAutocomplete(true),
  )
  .addChannelOption(option => option.setName('channel').setDescription(tl.channel).setRequired(false))
  .addStringOption(option =>
    option
      .setName('timezone')
      .setDescription('Timezone for any date/time you enter (default: UTC)')
      .setRequired(false)
      .addChoices(...TIMEZONE_CHOICES),
  )
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Custom message (overrides template body)')
      .setRequired(false)
      .setMaxLength(4000),
  );

/* =========================================================================
 * Template subcommand group — create / edit / delete / list / preview / reset
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
        option.setName('template').setDescription('Template to edit').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('delete')
      .setDescription('Delete a custom template')
      .addStringOption(option =>
        option.setName('template').setDescription('Template to delete').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand(sub => sub.setName('list').setDescription('List all templates for this server'))
  .addSubcommand(sub =>
    sub
      .setName('preview')
      .setDescription('Preview a template with example values')
      .addStringOption(option =>
        option.setName('template').setDescription('Template to preview').setRequired(true).setAutocomplete(true),
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
  .toJSON();
