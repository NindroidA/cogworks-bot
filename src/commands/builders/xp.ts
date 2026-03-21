import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';

/**
 * /rank [user] — View XP rank card
 */
export const rank = new SlashCommandBuilder()
  .setName('rank')
  .setDescription("View your XP rank or another user's rank")
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('The user to view (defaults to yourself)')
      .setRequired(false),
  )
  .toJSON();

/**
 * /leaderboard [page] — View XP leaderboard
 */
export const leaderboard = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the server XP leaderboard')
  .addIntegerOption(option =>
    option
      .setName('page')
      .setDescription('Page number (10 per page)')
      .setRequired(false)
      .setMinValue(1),
  )
  .toJSON();

/**
 * /xp admin set/reset/reset-all — XP admin commands
 */
export const xpAdmin = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('XP administration commands')
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(sub =>
    sub
      .setName('set')
      .setDescription("Set a user's XP to a specific value")
      .addUserOption(option =>
        option.setName('user').setDescription('The user to modify').setRequired(true),
      )
      .addIntegerOption(option =>
        option.setName('xp').setDescription('The XP value to set').setRequired(true).setMinValue(0),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('reset')
      .setDescription("Reset a user's XP to zero")
      .addUserOption(option =>
        option.setName('user').setDescription('The user to reset').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub.setName('reset-all').setDescription('Reset all XP data for this server'),
  )
  .toJSON();
