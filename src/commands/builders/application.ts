import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder, SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.application.position;
const tSC = lang.application.position.subcmdDescrp;

/* position subcommands */
const positionAdd = new SlashCommandSubcommandBuilder()
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

const positionRemove = new SlashCommandSubcommandBuilder()
    .setName('remove')
    .setDescription(tSC.remove)
    .addIntegerOption(option => option
        .setName('id')
        .setDescription(tSC['remove-id'])
        .setRequired(true)
    );

const positionToggle = new SlashCommandSubcommandBuilder()
    .setName('toggle')
    .setDescription(tSC.toggle)
    .addIntegerOption(option => option
        .setName('id')
        .setDescription(tSC['toggle-id'])
        .setRequired(true)
    );

const positionList = new SlashCommandSubcommandBuilder()
    .setName('list')
    .setDescription(tSC.list);

const positionRefresh = new SlashCommandSubcommandBuilder()
    .setName('refresh')
    .setDescription(tSC.refresh);

/* position subcommand group */
const positionGroup = new SlashCommandSubcommandGroupBuilder()
    .setName('position')
    .setDescription(tl.cmdDescrp)
    .addSubcommand(positionAdd)
    .addSubcommand(positionRemove)
    .addSubcommand(positionToggle)
    .addSubcommand(positionList)
    .addSubcommand(positionRefresh);

/* main slash command */
export const application = new SlashCommandBuilder()
    .setName('application')
    .setDescription('Manage application system')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommandGroup(positionGroup)
    .toJSON();
