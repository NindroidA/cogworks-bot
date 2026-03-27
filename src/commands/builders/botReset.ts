import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const botReset = new SlashCommandBuilder()
  .setName('bot-reset')
  .setDescription('Factory reset Cogworks — removes all data and messages from this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();
