import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import lang from '../../utils/lang.json';

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

/* main slash command */
export const archiveMigration = new SlashCommandBuilder()
    .setName('archive-migration')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(analyzer)
    .toJSON();
