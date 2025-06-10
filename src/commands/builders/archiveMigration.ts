import { ChannelType, PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.archiveMigration;

/* subcommands */
const analyzer = new SlashCommandSubcommandBuilder()
    .setName('analyzer')
    .setDescription(tl.analyzer.cmdDescrp)
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.analyzer.channelOptionDescrp)
        .setRequired(true)
    );

const downloader = new SlashCommandSubcommandBuilder()
    .setName('downloader')
    .setDescription(tl.downloader.cmdDescrp)
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.downloader.channelOptionDescrp)
        .setRequired(true)
    );

const migrator = new SlashCommandSubcommandBuilder()
    .setName('migrator')
    .setDescription(tl.migrator.cmdDescrp)
    .addChannelOption((option) => option
        .setName('forum-channel')
        .setDescription(tl.migrator.channelOptionDescrp)
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildForum)
    )
    .addBooleanOption((option) => option
        .setName('dry-run')
        .setDescription(tl.migrator.booleanOptionDescrp)
        .setRequired(true)
    );

/* main slash command */
export const archiveMigration = new SlashCommandBuilder()
    .setName('archive-migration')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(analyzer)
    .addSubcommand(downloader)
    .addSubcommand(migrator)
    .toJSON();
