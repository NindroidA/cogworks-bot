import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const archive = new SlashCommandBuilder()
  .setName('archive')
  .setDescription('Manage and clean up archived data')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub =>
    sub
      .setName('cleanup')
      .setDescription('Export and clean up archived tickets, applications, or all data')
      .addStringOption(opt =>
        opt
          .setName('system')
          .setDescription('Which archives to clean up')
          .setRequired(true)
          .addChoices(
            { name: 'Tickets', value: 'tickets' },
            { name: 'Applications', value: 'applications' },
            { name: 'All', value: 'all' },
          ),
      ),
  )
  .toJSON();
