import { ChannelType, PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.ticketSetup;

/* subcommands */
const channel = new SlashCommandSubcommandBuilder()
    .setName('channel')
    .setDescription(tl.subcmdDescrp.channel)
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.subcmdDescrp.option)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    );

const archive = new SlashCommandSubcommandBuilder()
    .setName('archive')
    .setDescription(tl.subcmdDescrp.archive)
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.subcmdDescrp.option)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildForum)
    );

const category = new SlashCommandSubcommandBuilder()
    .setName('category')
    .setDescription(tl.subcmdDescrp.category)
    .addChannelOption((option) => option
        .setName('category')
        .setDescription(tl.subcmdDescrp.catset)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)
    );


/* main slash command */
export const ticketSetup = new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(channel)
    .addSubcommand(archive)
    .addSubcommand(category)
    .toJSON();