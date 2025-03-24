import { ChannelType, PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';

/* subcommands */
const channel = new SlashCommandSubcommandBuilder()
    .setName('channel')
    .setDescription('Sets the global ticket channel')
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription('channel to send the message to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    );

const archive = new SlashCommandSubcommandBuilder()
    .setName('archive')
    .setDescription('Sets the archive ticket channel')
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription('channel to send the message to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildForum)
    );


/* main slash command */
export const ticketSetup = new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Initializes bot ticketing system')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(channel)
    .addSubcommand(archive)
    .toJSON();