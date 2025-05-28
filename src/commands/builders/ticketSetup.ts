import { ChannelType, PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import lang from '../../utils/lang.json';

/* subcommands */
const channel = new SlashCommandSubcommandBuilder()
    .setName('channel')
    .setDescription(lang.ticketSetup.subcmdDescrp.channel)
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(lang.ticketSetup.subcmdDescrp.option)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    );

const archive = new SlashCommandSubcommandBuilder()
    .setName('archive')
    .setDescription(lang.ticketSetup.subcmdDescrp.archive)
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(lang.ticketSetup.subcmdDescrp.option)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildForum)
    );

const category = new SlashCommandSubcommandBuilder()
    .setName('category')
    .setDescription(lang.ticketSetup.subcmdDescrp.category)
    .addChannelOption((option) => option
        .setName('category')
        .setDescription(lang.ticketSetup.subcmdDescrp.catset)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)
    );


/* main slash command */
export const ticketSetup = new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription(lang.ticketSetup.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(channel)
    .addSubcommand(archive)
    .addSubcommand(category)
    .toJSON();