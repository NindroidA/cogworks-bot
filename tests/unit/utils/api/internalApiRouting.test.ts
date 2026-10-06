/**
 * Internal API routing, body parsing and bind address, over real HTTP.
 *
 * - Guild-scoped handlers used to share one route map with the top-level ones
 *   and were matched against the full path first, so `POST /setup/toggle` with
 *   no /internal/guilds/:id prefix ran the guild handler with guildId '' and
 *   skipped the bot-in-guild check. Top-level handlers were also reachable
 *   under /internal/guilds/<id>/internal/...
 * - A JSON body of `null` (or an array) reached handlers and crashed `body[x]`.
 * - The bind address comes from BOT_INTERNAL_HOST (default 0.0.0.0, as before);
 *   this suite sets 127.0.0.1 so it never listens beyond loopback.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { AddressInfo } from 'node:net';
import type { Client } from 'discord.js';
import { getBindHost } from '../../../../src/utils/api/bindHost';
import { InternalApiServer } from '../../../../src/utils/api/internalApiServer';

const TOKEN = 'routing-test-token';
const GUILD = '100000000000000001';

const calls: Array<{ route: string; guildId: string; body: Record<string, unknown> }> = [];
const server = new InternalApiServer();
let base = '';
const originalToken = process.env.COGWORKS_INTERNAL_API_TOKEN;
const originalHost = process.env.BOT_INTERNAL_HOST;

beforeAll(async () => {
  process.env.COGWORKS_INTERNAL_API_TOKEN = TOKEN;
  process.env.BOT_INTERNAL_HOST = '127.0.0.1';
  const client = { guilds: { cache: { has: (id: string) => id === GUILD } } } as unknown as Client;
  server.initialize(client);
  server.registerLateRoutes(routes => {
    routes.set('POST /probe', async (guildId, body) => {
      calls.push({ route: 'guild', guildId, body });
      return { ok: true, field: body.field ?? null };
    });
    routes.set('GET /internal/probe', async guildId => {
      calls.push({ route: 'top', guildId, body: {} });
      return { ok: true };
    });
  });
  server.start(0);
  const raw = (server as unknown as { server: { address(): AddressInfo; listening: boolean; once: Function } }).server;
  if (!raw.listening) await new Promise(resolve => raw.once('listening', resolve));
  const { address, port } = raw.address();
  expect(address).toBe('127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.stop();
  if (originalToken === undefined) delete process.env.COGWORKS_INTERNAL_API_TOKEN;
  else process.env.COGWORKS_INTERNAL_API_TOKEN = originalToken;
  if (originalHost === undefined) delete process.env.BOT_INTERNAL_HOST;
  else process.env.BOT_INTERNAL_HOST = originalHost;
});

beforeEach(() => {
  calls.length = 0;
});

const call = (method: string, path: string, body?: string) =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body,
  });

describe('route scoping', () => {
  test('a guild route runs behind /internal/guilds/:id with that guildId', async () => {
    const res = await call('POST', `/internal/guilds/${GUILD}/probe`, '{"field":"x"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, field: 'x' });
    expect(calls).toEqual([{ route: 'guild', guildId: GUILD, body: { field: 'x' } }]);
  });

  test('a guild route without the guild prefix is a 404 and never runs', async () => {
    const res = await call('POST', '/probe', '{}');
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('a real guild route (setup/toggle) without the prefix is a 404', async () => {
    const res = await call('POST', '/setup/toggle', '{"systemId":"x","enabled":true}');
    expect(res.status).toBe(404);
  });

  test('a top-level route runs with no guildId', async () => {
    const res = await call('GET', '/internal/probe');
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ route: 'top', guildId: '', body: {} }]);
  });

  test('a top-level route is not reachable under a guild prefix', async () => {
    const res = await call('GET', `/internal/guilds/${GUILD}/internal/probe`);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('a guild the bot is not in is still a 404', async () => {
    const res = await call('POST', '/internal/guilds/100000000000000999/probe', '{}');
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('body parsing', () => {
  test.each(['null', '[]', '"text"', '42'])('a %s body is a 400 and the handler never runs', async raw => {
    const res = await call('POST', `/internal/guilds/${GUILD}/probe`, raw);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('an empty body is treated as {}', async () => {
    const res = await call('POST', `/internal/guilds/${GUILD}/probe`);
    expect(res.status).toBe(200);
    expect(calls[0].body).toEqual({});
  });
});

describe('getBindHost', () => {
  test('defaults to every interface (unchanged behavior) and honours BOT_INTERNAL_HOST', () => {
    const saved = process.env.BOT_INTERNAL_HOST;
    try {
      delete process.env.BOT_INTERNAL_HOST;
      expect(getBindHost()).toBe('0.0.0.0');
      process.env.BOT_INTERNAL_HOST = ' 127.0.0.1 ';
      expect(getBindHost()).toBe('127.0.0.1');
      process.env.BOT_INTERNAL_HOST = '';
      expect(getBindHost()).toBe('0.0.0.0');
    } finally {
      if (saved === undefined) delete process.env.BOT_INTERNAL_HOST;
      else process.env.BOT_INTERNAL_HOST = saved;
    }
  });
});
