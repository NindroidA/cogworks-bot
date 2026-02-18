import { SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.dev.builder;

export const dev = new SlashCommandBuilder()
  .setName('dev')
  .setDescription(tl.cmdDescrp)
  .setDMPermission(false)
  .addSubcommand(subcommand =>
    subcommand.setName('bulk-close-tickets').setDescription(tl.bulkCloseTickets),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete-archived-ticket')
      .setDescription(tl.deleteArchivedTicket.descrp)
      .addUserOption(option =>
        option.setName('user').setDescription(tl.deleteArchivedTicket.user).setRequired(true),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand.setName('delete-all-archived-tickets').setDescription(tl.deleteAllArchivedTickets),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete-archived-application')
      .setDescription(tl.deleteArchivedApplication.descrp)
      .addUserOption(option =>
        option.setName('user').setDescription(tl.deleteArchivedApplication.user).setRequired(true),
      ),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete-all-archived-applications')
      .setDescription(tl.deleteAllArchivedApplications),
  );
