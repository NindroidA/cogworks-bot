import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.ticket.customTypes;

/* subcommands */
const typeAdd = new SlashCommandSubcommandBuilder()
    .setName('type-add')
    .setDescription(tl.typeAdd.cmdDescrp);

const typeEdit = new SlashCommandSubcommandBuilder()
    .setName('type-edit')
    .setDescription(tl.typeEdit.cmdDescrp)
    .addStringOption((option) => option
        .setName('type')
        .setDescription(tl.typeEdit.optionDescrp)
        .setRequired(true)
        .setAutocomplete(true)
    );

const typeList = new SlashCommandSubcommandBuilder()
    .setName('type-list')
    .setDescription(tl.typeList.cmdDescrp);

const typeToggle = new SlashCommandSubcommandBuilder()
    .setName('type-toggle')
    .setDescription(tl.typeToggle.cmdDescrp)
    .addStringOption((option) => option
        .setName('type')
        .setDescription(tl.typeToggle.optionDescrp)
        .setRequired(true)
        .setAutocomplete(true)
    );

const typeDefault = new SlashCommandSubcommandBuilder()
    .setName('type-default')
    .setDescription(tl.typeDefault.cmdDescrp)
    .addStringOption((option) => option
        .setName('type')
        .setDescription(tl.typeDefault.optionDescrp)
        .setRequired(true)
        .setAutocomplete(true)
    );

const typeRemove = new SlashCommandSubcommandBuilder()
    .setName('type-remove')
    .setDescription(tl.typeRemove.cmdDescrp)
    .addStringOption((option) => option
        .setName('type')
        .setDescription(tl.typeRemove.optionDescrp)
        .setRequired(true)
        .setAutocomplete(true)
    );

const typeFields = new SlashCommandSubcommandBuilder()
    .setName('type-fields')
    .setDescription('Configure custom input fields for a ticket type')
    .addStringOption((option) => option
        .setName('type')
        .setDescription('Select the ticket type to configure')
        .setRequired(true)
        .setAutocomplete(true)
    );

const emailImport = new SlashCommandSubcommandBuilder()
    .setName('import-email')
    .setDescription(tl.emailImport.cmdDescrp);

/* main slash command */
export const ticket = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage custom ticket types and import email tickets')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(typeAdd)
    .addSubcommand(typeEdit)
    .addSubcommand(typeList)
    .addSubcommand(typeToggle)
    .addSubcommand(typeDefault)
    .addSubcommand(typeRemove)
    .addSubcommand(typeFields)
    .addSubcommand(emailImport)
    .toJSON();
