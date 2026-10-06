/**
 * Interface the bot's HTTP servers (internal API, health) listen on.
 *
 * Defaults to every interface (`0.0.0.0`), as before, because ninsys-api may
 * reach the bot from another network namespace. With `network_mode: host` and
 * ninsys-api on localhost, set BOT_INTERNAL_HOST=127.0.0.1 so ports 3002/3003
 * aren't open on the host's LAN/public interfaces. No imports, so maintenance
 * mode can use it without the DB stack.
 */
export function getBindHost(): string {
  return process.env.BOT_INTERNAL_HOST?.trim() || '0.0.0.0';
}
