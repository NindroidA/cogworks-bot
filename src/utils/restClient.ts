import { REST } from 'discord.js';

// CLIENT_ID is read eagerly because it's plain config; the REST client is
// the eager piece worth deferring (it pulls in the bot token and fails
// hard if unset, which breaks tests/tools that transitively import this
// module without needing Discord at all).
export const CLIENT_ID = process.env.RELEASE === 'dev' ? process.env.DEV_CLIENT_ID! : process.env.CLIENT_ID!;

let _rest: REST | null = null;

/**
 * Shared Discord REST client. Reused across `index.ts`, `guildCreate`, and
 * `botReset` so we don't spin up multiple REST instances with the same
 * token. Constructed lazily on first call so importing this module does
 * not require a bot token.
 */
export function getRest(): REST {
  if (_rest) return _rest;
  const token = process.env.RELEASE === 'dev' ? process.env.DEV_BOT_TOKEN : process.env.BOT_TOKEN;
  if (!token) {
    throw new Error(
      'Discord bot token not configured — set BOT_TOKEN (or DEV_BOT_TOKEN when RELEASE=dev) before calling getRest()',
    );
  }
  _rest = new REST({ version: '10' }).setToken(token);
  return _rest;
}
