/**
 * verifyProof: the applier's last look before a write. Only `missing` may
 * write, so every unproven case must come back as something else.
 */
import { describe, expect, test } from 'bun:test';
import type { Guild } from 'discord.js';
import { createRestFetcher } from '../../../../../src/utils/health/context';
import { verifyProof } from '../../../../../src/utils/health/repair/verify';
import { makeFakeGuild } from '../../../../helpers/fakeGuild';
import { restError, withMessages, withThreadFetch } from '../moderationHelpers';

const TEXT = '300000000000000001';
const GONE = '300000000000000666';
const ROLE = '200000000000000001';
const THREAD = '400000000000000001';
const MSG = '500000000000000001';
const GONE_MSG = '500000000000000666';

const guildWith = (available = true) => makeFakeGuild({ available, roles: [{ id: ROLE }], channels: [{ id: TEXT }] });
const rest = () => createRestFetcher({ concurrency: 2, timeoutMs: 1_000, maxCalls: 10 });
/** `guild.channels.fetch` that fails with a REST error code. */
const failChannelFetch = (guild: Guild, code: number) => {
  (guild.channels as unknown as Record<string, unknown>).fetch = async () => {
    throw restError(code);
  };
};

describe('verifyProof', () => {
  test('roles and channels come from the cache', async () => {
    const guild = guildWith();
    expect(await verifyProof(guild, { kind: 'role', id: ROLE }, rest())).toBe('ok');
    expect(await verifyProof(guild, { kind: 'role', id: GONE }, rest())).toBe('missing');
    expect(await verifyProof(guild, { kind: 'channel', id: TEXT }, rest())).toBe('ok');
    expect(await verifyProof(guild, { kind: 'channel', id: GONE }, rest())).toBe('missing');
  });

  test('an unavailable guild proves nothing and makes no REST call', async () => {
    const guild = guildWith(false);
    const fetched = withThreadFetch(guild, []);
    for (const kind of ['role', 'channel', 'thread'] as const) {
      expect(await verifyProof(guild, { kind, id: GONE }, rest())).toBe('unknown');
    }
    expect(await verifyProof(guild, { kind: 'message', id: GONE_MSG, channelId: GONE }, rest())).toBe('unknown');
    expect(fetched).toEqual([]);
  });

  test('threads: a cached channel is ok, otherwise one REST lookup decides', async () => {
    const guild = guildWith();
    const fetched = withThreadFetch(guild, [THREAD]);
    expect(await verifyProof(guild, { kind: 'thread', id: TEXT }, rest())).toBe('ok');
    expect(await verifyProof(guild, { kind: 'thread', id: THREAD }, rest())).toBe('ok');
    expect(await verifyProof(guild, { kind: 'thread', id: GONE }, rest())).toBe('missing');
    expect(fetched).toEqual([THREAD, GONE]);
  });

  test('threads: Missing Access and server errors are not proof', async () => {
    const guild = guildWith();
    failChannelFetch(guild, 50001);
    expect(await verifyProof(guild, { kind: 'thread', id: GONE }, rest())).toBe('inaccessible');
    failChannelFetch(guild, 500);
    expect(await verifyProof(guild, { kind: 'thread', id: GONE }, rest())).toBe('unknown');
  });

  test("a channel type discord.js can't construct (fetch resolves null) is unknown, never missing", async () => {
    const guild = guildWith();
    (guild.channels as unknown as Record<string, unknown>).fetch = async () => null;
    expect(await verifyProof(guild, { kind: 'thread', id: GONE }, rest())).toBe('unknown');
    expect(await verifyProof(guild, { kind: 'message', id: GONE_MSG, channelId: GONE }, rest())).toBe('unknown');
  });

  test('messages: fetched in their channel; a deleted channel took the message with it', async () => {
    const guild = guildWith();
    const fetched = withMessages(guild, TEXT, [MSG]);
    withThreadFetch(guild, []);
    expect(await verifyProof(guild, { kind: 'message', id: MSG, channelId: TEXT }, rest())).toBe('ok');
    expect(await verifyProof(guild, { kind: 'message', id: GONE_MSG, channelId: TEXT }, rest())).toBe('missing');
    expect(await verifyProof(guild, { kind: 'message', id: GONE_MSG, channelId: GONE }, rest())).toBe('missing');
    expect(await verifyProof(guild, { kind: 'message', id: GONE_MSG }, rest())).toBe('unknown');
    expect(fetched).toEqual([MSG, GONE_MSG]);
  });

  test('messages: an uncached channel that exists without a message list is not proof', async () => {
    const guild = guildWith();
    withThreadFetch(guild, [THREAD]);
    expect(await verifyProof(guild, { kind: 'message', id: GONE_MSG, channelId: THREAD }, rest())).toBe('unknown');
  });

  test('a spent budget is skipped, never missing', async () => {
    const guild = guildWith();
    withThreadFetch(guild, []);
    const budget = createRestFetcher({ concurrency: 1, timeoutMs: 1_000, maxCalls: 1 });
    expect(await verifyProof(guild, { kind: 'thread', id: GONE }, budget)).toBe('missing');
    expect(await verifyProof(guild, { kind: 'thread', id: GONE }, budget)).toBe('skipped');
  });
});
