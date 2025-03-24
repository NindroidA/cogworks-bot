import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder, SlashCommandSubcommandGroupBuilder } from "discord.js";

/* subcommands */
const approve = new SlashCommandSubcommandBuilder()
    .setName('approve')
    .setDescription('Approve a Bapple');

const deny = new SlashCommandSubcommandBuilder()
    .setName('deny')
    .setDescription('Deny a Bapple'); 

/* subcommand groups */
const bapple = new SlashCommandSubcommandGroupBuilder()
    .setName('bapple')
    .setDescription('Dealing with ban appeals')
    .addSubcommand(approve)  
    .addSubcommand(deny);

/* main slash command */
export const ticketReply = new SlashCommandBuilder()
    .setName('ticket-reply')
    .setDescription('Various replies for tickets')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommandGroup(bapple)
    .toJSON();