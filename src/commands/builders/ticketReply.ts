import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder, SlashCommandSubcommandGroupBuilder } from "discord.js";
import lang from "../../utils/lang.json";

/* subcommands */
const approve = new SlashCommandSubcommandBuilder()
    .setName('approve')
    .setDescription(lang.ticketReply.subcmdDescrp.approve);

const deny = new SlashCommandSubcommandBuilder()
    .setName('deny')
    .setDescription(lang.ticketReply.subcmdDescrp.deny); 

/* subcommand groups */
const bapple = new SlashCommandSubcommandGroupBuilder()
    .setName('bapple')
    .setDescription(lang.ticketReply.subcmdGroupDescrp.bapple)
    .addSubcommand(approve)  
    .addSubcommand(deny);

/* main slash command */
export const ticketReply = new SlashCommandBuilder()
    .setName('ticket-reply')
    .setDescription(lang.ticketReply.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommandGroup(bapple)
    .toJSON();