/**
 * GET /internal/commands: the webapp's command browser groups slash commands
 * by category. A command missing from COMMAND_CATEGORIES lands in "Other", so
 * every registered slash command needs an entry.
 */
import { describe, expect, test } from 'bun:test';
import type { Client } from 'discord.js';
import { registerCommandHandlers } from '../../../../src/utils/api/handlers/commandHandlers';
import type { RouteHandler } from '../../../../src/utils/api/router';

interface ListedCommand {
  name: string;
  category: string;
}

/** `dev` predates the category table; `dev-test` and `dev-suite` only register on the DEV bot. */
const UNCATEGORIZED = new Set(['dev', 'dev-test', 'dev-suite']);

async function listCommands(): Promise<ListedCommand[]> {
  const routes = new Map<string, RouteHandler>();
  registerCommandHandlers({} as Client, routes);
  const handler = routes.get('GET /internal/commands');
  if (!handler) throw new Error('GET /internal/commands is not registered');
  const response = await handler('', {}, '/internal/commands');
  return response.commands as ListedCommand[];
}

describe('GET /internal/commands categories', () => {
  test('/bot-health is listed under Setup with /bot-setup and /bot-reset', async () => {
    const byName = new Map((await listCommands()).map(c => [c.name, c.category]));
    expect(byName.get('bot-health')).toBe('Setup');
    expect(byName.get('bot-setup')).toBe('Setup');
    expect(byName.get('bot-reset')).toBe('Setup');
  });

  test('every slash command has a category (none fall back to "Other")', async () => {
    const other = (await listCommands())
      .filter(c => c.category === 'Other' && !UNCATEGORIZED.has(c.name))
      .map(c => c.name);
    expect(other).toEqual([]);
  });
});
