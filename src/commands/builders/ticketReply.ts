import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder, SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.ticketReply;

/* subcommands */
const approve = new SlashCommandSubcommandBuilder()
    .setName('approve')
    .setDescription(tl.subcmdDescrp.approve);

const deny = new SlashCommandSubcommandBuilder()
    .setName('deny')
    .setDescription(tl.subcmdDescrp.deny); 

/* subcommand groups */
const bapple = new SlashCommandSubcommandGroupBuilder()
    .setName('bapple')
    .setDescription(tl.subcmdGroupDescrp.bapple)
    .addSubcommand(approve)  
    .addSubcommand(deny);

/* main slash command */
export const ticketReply = new SlashCommandBuilder()
    .setName('ticket-reply')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommandGroup(bapple)
    .toJSON();