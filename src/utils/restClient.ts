import { REST } from 'discord.js';

/**
 * Resolve the Discord application client ID from environment. Deferred so
 * importing this module does not require the env to be set — matching the
 * `getRest()` lazy pattern. Throws if both CLIENT_ID and DEV_CLIENT_ID are
 * unset in the respective mode.
 */
export function getClientId(): string {
  const id = process.env.RELEASE === 'dev' ? process.env.DEV_CLIENT_ID : process.env.CLIENT_ID;
  if (!id) {
    throw new Error(
      'Discord client ID not configured — set CLIENT_ID (or DEV_CLIENT_ID when RELEASE=dev) before calling getClientId()',
    );
  }
  return id;
}

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
