import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.application.position;
const tSC = lang.application.position.subcmdDescrp;

/* subcommands */
const add = new SlashCommandSubcommandBuilder()
    .setName('add')
    .setDescription(tSC.add)
    .addStringOption(option => option
        .setName('template')
        .setDescription(tSC['add-template'])
        .addChoices(
            { name: 'Set Builder', value: 'set_builder' },
        )
    )
    .addStringOption(option => option
        .setName('title')
        .setDescription(tSC['add-title'])
    )
    .addStringOption(option => option
        .setName('description')
        .setDescription(tSC['add-description'])
    );

const remove = new SlashCommandSubcommandBuilder()
    .setName('remove')
    .setDescription(tSC.remove)
    .addIntegerOption(option => option
        .setName('id')
        .setDescription(tSC['remove-id'])
        .setRequired(true)
    );

const toggle = new SlashCommandSubcommandBuilder()
    .setName('toggle')
    .setDescription(tSC.toggle)
    .addIntegerOption(option => option
        .setName('id')
        .setDescription(tSC['toggle-id'])
        .setRequired(true)
    );

const list = new SlashCommandSubcommandBuilder()
    .setName('list')
    .setDescription(tSC.list);

const refresh = new SlashCommandSubcommandBuilder()
    .setName('refresh')
    .setDescription(tSC.refresh);

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