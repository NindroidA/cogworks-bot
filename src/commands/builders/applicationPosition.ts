import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.application.setup;

/* subcommands */
const add = new SlashCommandSubcommandBuilder()
    .setName('add')
    .setDescription('Add a new position')
    .addStringOption(option => option
        .setName('template')
        .setDescription('Use a predefined template')
        .addChoices(
            { name: 'Set Builder', value: 'set_builder' },
        )
    )
    .addStringOption(option => option
        .setName('title')
        .setDescription('Custom position title (if not using template)')
    )
    .addStringOption(option => option
        .setName('description')
        .setDescription('Custom position description (if not using template)')
    );

const remove = new SlashCommandSubcommandBuilder()
    .setName('remove')
    .setDescription('Remove a position')
    .addIntegerOption(option => option
        .setName('id')
        .setDescription('Position ID to remove')
        .setRequired(true)
    );

const toggle = new SlashCommandSubcommandBuilder()
    .setName('toggle')
    .setDescription('Toggle position visibility')
    .addIntegerOption(option => option
        .setName('id')
        .setDescription('Position ID to toggle')
        .setRequired(true)
    );

const list = new SlashCommandSubcommandBuilder()
    .setName('list')
    .setDescription('List all positions');

const refresh = new SlashCommandSubcommandBuilder()
    .setName('refresh')
    .setDescription('Refresh the application channel message');

/* main slash command */
export const applicationPosition = new SlashCommandBuilder()
    .setName('application-position')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(add)
    .addSubcommand(remove)
    .addSubcommand(toggle)
    .addSubcommand(list)
    .addSubcommand(refresh)
    .toJSON();