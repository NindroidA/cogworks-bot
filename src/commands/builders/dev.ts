import { SlashCommandBuilder } from 'discord.js';

export const dev = new SlashCommandBuilder()
    .setName('dev')
    .setDescription('[OWNER ONLY] Development and maintenance commands')
    .setDMPermission(false)
    .addSubcommand(subcommand =>
        subcommand
            .setName('bulk-close-tickets')
            .setDescription('⚠️ Close all active tickets in this server')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('delete-archived-ticket')
            .setDescription('Delete a specific archived ticket by user')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('The user whose archived ticket to delete')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('delete-all-archived-tickets')
            .setDescription('⚠️ DELETE ALL archived tickets in this server')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('delete-archived-application')
            .setDescription('Delete a specific archived application by user')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('The user whose archived application to delete')
                    .setRequired(true)
            )
    )
        .addSubcommand(subcommand =>
        subcommand
            .setName('delete-all-archived-applications')
            .setDescription('⚠️ Delete ALL archived applications in this server')
    );
