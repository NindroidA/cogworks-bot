/**
 * POST /config/refresh asks for a guild command refresh.
 *
 * The dashboard writes module configs straight to the DB (bait `enabled`,
 * first memory/announcement config) and then calls this route. Command gating
 * depends on those rows, but the route only cleared caches, so /baitchannel
 * and friends stayed visible or hidden until the next restart.
 *
 * The refresh is injected (3rd arg), as registerTicketHandlers does with its
 * archive workflow, instead of mock.module'ing the shared commandGating module.
 */

import { beforeEach, describe, expect, jest, test } from 'bun:test';
import type { Client } from 'discord.js';
import { registerConfigHandlers } from '../../../../src/utils/api/handlers/configHandlers';

const GUILD = '100000000000000001';
const requestRefresh = jest.fn((_guildId: string) => undefined);
const clearConfigCache = jest.fn((_guildId: string) => undefined);
let refresh: (guildId: string, body: Record<string, unknown>) => Promise<unknown>;

beforeEach(() => {
  requestRefresh.mockClear();
  clearConfigCache.mockClear();
  const routes = new Map();
  const client = { baitChannelManager: { clearConfigCache } } as unknown as Client;
  registerConfigHandlers(client, routes as never, requestRefresh);
  refresh = routes.get('POST /config/refresh');
});

describe('POST /config/refresh', () => {
  test.each(['baitChannel', 'memory', 'announcement', 'ticket'])('configType %s requests a command refresh', async type => {
    // No triggeredBy, so the audit write is skipped (no DB)
    expect(await refresh(GUILD, { configType: type })).toEqual({ success: true, configType: type });
    expect(requestRefresh).toHaveBeenCalledWith(GUILD);
  });

  test('baitChannel still clears the bait config cache', async () => {
    await refresh(GUILD, { configType: 'baitChannel' });
    expect(clearConfigCache).toHaveBeenCalledWith(GUILD);
  });

  test('a missing configType is a 400 and refreshes nothing', async () => {
    await expect(refresh(GUILD, {})).rejects.toMatchObject({ statusCode: 400 });
    expect(requestRefresh).not.toHaveBeenCalled();
  });
});
