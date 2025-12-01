import { SlashCommandBuilder } from 'discord.js';

export const migrate = new SlashCommandBuilder()
    .setName('migrate')
    .setDescription('[OWNER ONLY] Migrate and update existing data')
    .setDMPermission(false)
    .addSubcommand(subcommand =>
        subcommand
            .setName('ticket-tags')
            .setDescription('Retroactively apply forum tags to existing archived tickets')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('application-tags')
            .setDescription('Retroactively apply forum tags to existing archived applications')
    );
