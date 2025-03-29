import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';

/* subcommands */
const modrole = new SlashCommandSubcommandBuilder()
    .setName('modrole')
    .setDescription('Sets the Mode Role ID')
    .addStringOption((option) => option
        .setName('modrole_id')
        .setDescription('your server mod role')
        .setRequired(true)
    );

const adminrole = new SlashCommandSubcommandBuilder()
    .setName('adminrole')
    .setDescription('Sets the Admin Role ID')
    .addStringOption((option) => option
        .setName('adminrole_id')
        .setDescription('your server admin role')
        .setRequired(true)
    );

/* main slash command */
export const botSetup = new SlashCommandBuilder()
    .setName('bot-setup')
    .setDescription('Initializes settings for the bot')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(modrole)
    .addSubcommand(adminrole)
    .toJSON();