import { SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.dev.migrate;

export const migrate = new SlashCommandBuilder()
  .setName('migrate')
  .setDescription(tl.cmdDescrp)
  .setDMPermission(false)
  .addSubcommand(subcommand => subcommand.setName('ticket-tags').setDescription(tl.ticketTags))
  .addSubcommand(subcommand =>
    subcommand.setName('application-tags').setDescription(tl.applicationTags),
  );
