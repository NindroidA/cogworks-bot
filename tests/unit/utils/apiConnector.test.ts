/**
 * APIConnector (v3.16.6): dedicated COGWORKS_API_TOKEN credential with a
 * deprecated bot-token fallback, and background registration retries.
 * fetch is replaced with a recorder; 404 stands in for "API not ready" since
 * 4xx skips the per-request retry sleeps.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { Client } from 'discord.js';
import { APIConnector } from '../../../src/utils/apiConnector';
import { INTERVALS } from '../../../src/utils/constants';
import { enhancedLogger } from '../../../src/utils/monitoring/enhancedLogger';

interface Call {
  method: string;
  path: string;
  auth: string | null;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let apiUp = true;

const client = {
  user: { id: '1', username: 'Cogworks' },
  guilds: { cache: { size: 2 } },
  users: { cache: { size: 5 } },
  isReady: () => true,
} as unknown as Client;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
  calls = [];
  apiUp = true;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      path: new URL(String(url)).pathname,
      auth: new Headers(init?.headers).get('authorization'),
    });
    return new Response(null, { status: apiUp ? 200 : 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

describe('APIConnector credentials', () => {
  test('sends COGWORKS_API_TOKEN as the bearer, never the Discord bot token', async () => {
    const connector = new APIConnector('http://api.test', 'dedicated-secret', 'discord-bot-token');
    await connector.registerBot(client);
    await connector.disconnect();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.auth).toBe('Bearer dedicated-secret');
  });

  test('falls back to the bot token when unset, with one deprecation warning that names no secret', async () => {
    const warn = jest.spyOn(enhancedLogger, 'warn');
    const connector = new APIConnector('http://api.test', '  ', 'discord-bot-token');
    await connector.registerBot(client);
    await connector.registerBot(client);
    await connector.disconnect();

    expect(calls[0].auth).toBe('Bearer discord-bot-token');
    const deprecations = warn.mock.calls.filter(([message]) => String(message).includes('COGWORKS_API_TOKEN'));
    expect(deprecations).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('discord-bot-token');
    warn.mockRestore();
  });
});

describe('APIConnector.connect registration retry', () => {
  test('keeps retrying with backoff until the API answers, then starts stats sync', async () => {
    jest.useFakeTimers();
    apiUp = false;
    const connector = new APIConnector('http://api.test', 'secret', 'discord-bot-token');

    expect(await connector.connect(client)).toBe(false);
    expect(connector.isConnectedToAPI()).toBe(false);

    // First retry after 30s: still down
    jest.advanceTimersByTime(INTERVALS.API_REGISTER_RETRY_BASE);
    await flushMicrotasks();
    expect(calls.filter(c => c.path === '/health')).toHaveLength(2);

    // Second retry doubles to 60s: the API is back
    apiUp = true;
    jest.advanceTimersByTime(INTERVALS.API_REGISTER_RETRY_BASE);
    await flushMicrotasks();
    expect(calls.filter(c => c.path === '/health')).toHaveLength(2);
    jest.advanceTimersByTime(INTERVALS.API_REGISTER_RETRY_BASE);
    await flushMicrotasks();
    expect(connector.isConnectedToAPI()).toBe(true);
    expect(calls.some(c => c.method === 'POST' && c.path === '/v2/cogworks/register')).toBe(true);

    // Stats sync is now armed (5 minute cadence)
    calls = [];
    jest.advanceTimersByTime(300_000);
    await flushMicrotasks();
    expect(calls.some(c => c.method === 'PUT' && c.path === '/v2/cogworks/stats')).toBe(true);

    await connector.disconnect();
  });

  test('with no API_URL (empty base URL) it makes no request and schedules no retry', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(enhancedLogger, 'warn');
    const connector = new APIConnector('', 'secret', 'discord-bot-token');

    expect(await connector.connect(client)).toBe(false);
    jest.advanceTimersByTime(INTERVALS.API_REGISTER_RETRY_MAX * 2);
    await flushMicrotasks();

    expect(calls).toHaveLength(0);
    expect(warn.mock.calls.some(([message]) => String(message).includes('will be retried'))).toBe(false);
    warn.mockRestore();
    await connector.disconnect();
  });

  test('disconnect cancels a pending retry', async () => {
    jest.useFakeTimers();
    apiUp = false;
    const connector = new APIConnector('http://api.test', 'secret', 'discord-bot-token');
    await connector.connect(client);
    await connector.disconnect();

    calls = [];
    jest.advanceTimersByTime(INTERVALS.API_REGISTER_RETRY_MAX * 2);
    await flushMicrotasks();
    expect(calls).toHaveLength(0);
  });
});
