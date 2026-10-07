/**
 * Reference helpers shared by the moderation checks: channel problems and
 * their severity, role assignability (parity with validateRoleForMenu), the
 * emoji pattern, and the deep-mode message and thread lookups.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  channelParams,
  channelProblem,
  channelReadable,
  channelSeverity,
  MESSAGE_CHANNEL,
  messageStatus,
  REACTION_CRITICAL,
  roleProblem,
  threadStatus,
  UNICODE_EMOJI,
} from '../../../../src/utils/health/checks/refHelpers';
import { validateRoleForMenu } from '../../../../src/utils/reactionRole/menuBuilder';
import { makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';
import { G, withMessages, withThreadFetch } from './moderationHelpers';

const TEXT = '300000000000000001';
const NEWS = '300000000000000002';
const VOICE = '300000000000000003';
const LOCKED = '300000000000000004';
const GONE = '300000000000000666';
const FORUM = '300000000000000005';
const THREAD = '300000000000000010';

const channels = [
  { id: TEXT },
  { id: NEWS, type: ChannelType.GuildAnnouncement },
  { id: VOICE, type: ChannelType.GuildVoice },
  { id: LOCKED, botPermissions: [PermissionFlagsBits.ViewChannel] },
  { id: FORUM, type: ChannelType.GuildForum },
  { id: THREAD, type: ChannelType.PublicThread },
];
const ctxFor = (init: Parameters<typeof makeFakeGuild>[0] = {}, deep = false) =>
  makeCheckContext({ guild: makeFakeGuild({ botPermissions: [PermissionFlagsBits.Administrator], channels, ...init }), deep });
const SEND = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] as const;

describe('channelProblem', () => {
  test('pass: text, announcement and voice channels (the dashboard accepts any text chat) with the permissions', () => {
    expect(channelProblem(ctxFor(), TEXT, MESSAGE_CHANNEL, SEND)).toBeNull();
    expect(channelProblem(ctxFor(), NEWS, MESSAGE_CHANNEL, SEND)).toBeNull();
    expect(channelProblem(ctxFor(), VOICE, MESSAGE_CHANNEL, SEND)).toBeNull();
  });

  test('fail: deleted, wrong type, missing permissions (only the missing ones listed)', () => {
    expect(channelProblem(ctxFor(), GONE, MESSAGE_CHANNEL, SEND)).toEqual({ problem: 'missing' });
    expect(channelProblem(ctxFor(), FORUM, MESSAGE_CHANNEL, SEND)).toEqual({ problem: 'wrong_type' });
    const found = channelProblem(ctxFor(), LOCKED, MESSAGE_CHANNEL, SEND);
    expect(found).toEqual({ problem: 'permissions', missing: ['SendMessages', 'ReadMessageHistory'] });
    expect(channelParams(LOCKED, found!)).toEqual({ channelId: LOCKED, permissions: 'SendMessages, ReadMessageHistory' });
  });

  test('no proof, no finding: unavailable guild, or no bot member to check permissions for', () => {
    expect(channelProblem(ctxFor({ available: false }), GONE, MESSAGE_CHANNEL, SEND)).toBeNull();
    expect(channelProblem(ctxFor({ botPermissions: null }), LOCKED, MESSAGE_CHANNEL, SEND)).toBeNull();
  });

  test('channelSeverity: block unless only non-critical permissions are missing', () => {
    expect(channelSeverity({ problem: 'missing' }, REACTION_CRITICAL)).toBe('block');
    expect(channelSeverity({ problem: 'wrong_type' }, REACTION_CRITICAL)).toBe('block');
    expect(channelSeverity({ problem: 'permissions', missing: ['ReadMessageHistory'] }, REACTION_CRITICAL)).toBe('block');
    expect(channelSeverity({ problem: 'permissions', missing: ['AddReactions'] }, REACTION_CRITICAL)).toBe('degraded');
  });

  test('channelReadable: lookups still run when only non-critical permissions are missing', () => {
    expect(channelReadable(null, REACTION_CRITICAL)).toBe(true);
    expect(channelReadable({ problem: 'permissions', missing: ['AddReactions'] }, REACTION_CRITICAL)).toBe(true);
    expect(channelReadable({ problem: 'permissions', missing: ['ReadMessageHistory'] }, REACTION_CRITICAL)).toBe(false);
    expect(channelReadable({ problem: 'missing' }, REACTION_CRITICAL)).toBe(false);
    expect(channelReadable({ problem: 'wrong_type' }, REACTION_CRITICAL)).toBe(false);
  });
});

describe('roleProblem', () => {
  const OK = '200000000000000001';
  const MANAGED = '200000000000000002';
  const HIGH = '200000000000000003';
  const EQUAL = '200000000000000004';
  const DELETED = '200000000000000666';
  const roles = [
    { id: OK, position: 2 },
    { id: MANAGED, position: 2, managed: true },
    { id: HIGH, position: 20 },
    { id: EQUAL, position: 10 },
  ];
  const ctx = makeCheckContext({ guild: makeFakeGuild({ roles, botHighestPosition: 10 }) });

  test('codes for each reason the bot cannot assign a role', () => {
    expect(roleProblem(ctx, OK)).toBeNull();
    expect(roleProblem(ctx, DELETED)).toBe('missing');
    expect(roleProblem(ctx, G)).toBe('everyone');
    expect(roleProblem(ctx, MANAGED)).toBe('managed');
    expect(roleProblem(ctx, HIGH)).toBe('too_high');
    expect(roleProblem(ctx, EQUAL)).toBe('too_high');
  });

  test('same verdict as validateRoleForMenu for every existing role', () => {
    for (const id of [G, OK, MANAGED, HIGH, EQUAL]) {
      const role = ctx.guild.roles.cache.get(id)!;
      expect({ id, ok: roleProblem(ctx, id) === null }).toEqual({ id, ok: validateRoleForMenu(role, { id: G }, 10).valid });
    }
  });

  test('no proof, no finding: unavailable guild; no bot member skips only the hierarchy', () => {
    expect(roleProblem(makeCheckContext({ guild: makeFakeGuild({ roles, available: false }) }), DELETED)).toBeNull();
    const noMe = makeCheckContext({ guild: makeFakeGuild({ roles, botPermissions: null }) });
    expect(roleProblem(noMe, HIGH)).toBeNull();
    expect(roleProblem(noMe, MANAGED)).toBe('managed');
  });
});

describe('UNICODE_EMOJI', () => {
  test.each(['✅', '❤️', '🇺🇸', '👍🏽', '1️⃣', '#️⃣', '👨‍👩‍👧'])('accepts %s', emoji => {
    expect(UNICODE_EMOJI.test(emoji)).toBe(true);
  });

  // Digits, # and * are emoji components, but on their own they are text.
  test.each(['', 'check', ':smile:', '✅ ok', '<:x:300000000000000001>', '1', '42', '#', '*'])('rejects %p', text => {
    expect(UNICODE_EMOJI.test(text)).toBe(false);
  });
});

describe('deep-mode lookups', () => {
  const MSG = '400000000000000001';
  const OLD = '400000000000000002';

  test('messageStatus: only in deep mode, and only in a resolvable text channel', async () => {
    const quick = ctxFor();
    expect(await messageStatus(quick, 'test', TEXT, MSG)).toBeNull();
    const deep = ctxFor({}, true);
    const fetched = withMessages(deep.guild, TEXT, [MSG]);
    expect(await messageStatus(deep, 'test', TEXT, MSG)).toBe('ok');
    expect(await messageStatus(deep, 'test', TEXT, OLD)).toBe('missing');
    expect(await messageStatus(deep, 'test', GONE, MSG)).toBeNull();
    expect(await messageStatus(deep, 'test', TEXT, null)).toBeNull();
    expect(fetched).toEqual([MSG, OLD]);
  });

  test('threadStatus: a cached thread is ok; an uncached one is unknown unless deep mode asks REST', async () => {
    expect(await threadStatus(ctxFor(), 'test', THREAD)).toBe('ok');
    expect(await threadStatus(ctxFor(), 'test', OLD)).toBe('unknown');
    const deep = ctxFor({}, true);
    const fetched = withThreadFetch(deep.guild, [MSG]);
    expect(await threadStatus(deep, 'test', MSG)).toBe('ok');
    expect(await threadStatus(deep, 'test', OLD)).toBe('missing');
    expect(await threadStatus(deep, 'test', THREAD)).toBe('ok');
    expect(fetched).toEqual([MSG, OLD]);
  });

  test("threadStatus: a channel type discord.js can't construct (fetch resolves null) is unknown", async () => {
    const deep = ctxFor({}, true);
    (deep.guild.channels as unknown as Record<string, unknown>).fetch = async () => null;
    expect(await threadStatus(deep, 'test', OLD)).toBe('unknown');
  });
});
