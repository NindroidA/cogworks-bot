/**
 * Shared Discord REST client
 *
 * Single REST instance reused by index.ts and event handlers (e.g., guildCreate)
 * to avoid creating duplicate clients with the same token.
 */

import { REST } from 'discord.js';

const TOKEN = process.env.RELEASE === 'dev' ? process.env.DEV_BOT_TOKEN! : process.env.BOT_TOKEN!;

export const CLIENT_ID =
  process.env.RELEASE === 'dev' ? process.env.DEV_CLIENT_ID! : process.env.CLIENT_ID!;

export const rest = new REST({ version: '10' }).setToken(TOKEN);
