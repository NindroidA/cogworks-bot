/**
 * Health engine reference resolution: REST error classification, role-ref
 * parsing, guild-cache lookups, channel kinds and bot permission gaps.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, DiscordAPIError, PermissionFlagsBits } from 'discord.js';
import {
  channelIsKind,
  classifyRestError,
  missingPermissions,
  parseRoleRef,
  resolveChannel,
  resolveRole,
} from '../../../../src/utils/health/refs';
import { FAKE_GUILD_ID, makeFakeGuild } from '../../../helpers/fakeGuild';

const ROLE = '200000000000000001';
const CHANNEL = '300000000000000001';

function apiError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError({ code, message: 'x' }, code, status, 'GET', '/x', {});
}

describe('classifyRestError', () => {
  test.each([
    ['Unknown Channel', apiError(10003, 404), 'missing'],
    ['Unknown Message', apiError(10008, 404), 'missing'],
    ['Unknown Role', apiError(10011, 404), 'missing'],
    ['Unknown User', apiError(10013, 404), 'missing'],
    ['Unknown Emoji', apiError(10014, 404), 'missing'],
    ['Missing Access', apiError(50001, 403), 'inaccessible'],
    ['Missing Permissions', apiError(50013, 403), 'inaccessible'],
    ['other API error', apiError(40060, 400), 'unknown'],
    ['5xx (no Discord code)', { status: 500, message: 'Internal Server Error' }, 'unknown'],
    ['429 rate limit', { name: 'RateLimitError', status: 429, retryAfter: 1000 }, 'unknown'],
    ['network error (string code)', { code: 'ECONNRESET' }, 'unknown'],
    ['timeout', new Error('timed out after 5000ms'), 'unknown'],
    ['null', null, 'unknown'],
  ])('%s → %s', (_label, error, expected) => {
    expect(classifyRestError(error)).toBe(expected as ReturnType<typeof classifyRestError>);
  });
});

describe('parseRoleRef', () => {
  test.each([
    [ROLE, { id: ROLE, legacy: false }],
    [`<@&${ROLE}>`, { id: ROLE, legacy: true }],
    [`<@${ROLE}>`, null], // a user mention is not a role
    ['staff', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%p → %p', (value, expected) => {
    expect(parseRoleRef(value as string | null | undefined)).toEqual(expected);
  });
});

describe('resolveRole / resolveChannel', () => {
  const guild = makeFakeGuild({ roles: [{ id: ROLE }], channels: [{ id: CHANNEL }] });

  test('found in cache → ok', () => {
    const role = resolveRole(guild, ROLE);
    expect(role.status).toBe('ok');
    expect(role.status === 'ok' && role.value.id).toBe(ROLE);
    expect(resolveChannel(guild, CHANNEL).status).toBe('ok');
  });

  test('absent from a complete cache → missing', () => {
    expect(resolveRole(guild, '200000000000000999').status).toBe('missing');
    expect(resolveChannel(guild, '300000000000000999').status).toBe('missing');
  });

  test('a cache miss for a possible thread → unknown (archived threads are never cached)', () => {
    expect(resolveChannel(guild, '300000000000000999', { mayBeThread: true }).status).toBe('unknown');
    expect(resolveChannel(guild, CHANNEL, { mayBeThread: true }).status).toBe('ok');
  });

  test('the @everyone role resolves (its id is the guild id)', () => {
    expect(resolveRole(guild, FAKE_GUILD_ID).status).toBe('ok');
  });

  test('unavailable guild → unknown, never missing (the cache may be partial)', () => {
    const outage = makeFakeGuild({ available: false });
    expect(resolveRole(outage, ROLE).status).toBe('unknown');
    expect(resolveChannel(outage, CHANNEL).status).toBe('unknown');
  });
});

describe('channelIsKind', () => {
  test.each([
    [ChannelType.GuildText, ['text'], true],
    [ChannelType.GuildAnnouncement, ['text'], false],
    [ChannelType.GuildAnnouncement, ['text', 'news'], true],
    [ChannelType.GuildForum, ['forum'], true],
    [ChannelType.GuildCategory, ['category'], true],
    [ChannelType.GuildVoice, ['voice'], true],
    [ChannelType.GuildStageVoice, ['stage'], true],
    [ChannelType.PublicThread, ['text', 'forum'], false],
  ] as const)('type %p in %p → %p', (type, kinds, expected) => {
    expect(channelIsKind({ type }, ...kinds)).toBe(expected);
  });
});

describe('missingPermissions', () => {
  test('guild-level: lists only what the bot lacks, by flag name', () => {
    const guild = makeFakeGuild({ botPermissions: [PermissionFlagsBits.ManageRoles] });
    expect(missingPermissions(guild.members.me, ['ManageRoles', 'ManageChannels', 'BanMembers'])).toEqual([
      'ManageChannels',
      'BanMembers',
    ]);
  });

  test('Administrator satisfies everything', () => {
    const guild = makeFakeGuild({ botPermissions: [PermissionFlagsBits.Administrator] });
    expect(missingPermissions(guild.members.me, ['ManageRoles', 'MentionEveryone'])).toEqual([]);
  });

  test('channel-level uses permissionsFor(me), not the guild permissions', () => {
    const guild = makeFakeGuild({
      botPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      channels: [{ id: CHANNEL, botPermissions: [PermissionFlagsBits.ViewChannel] }],
    });
    const channel = guild.channels.cache.get(CHANNEL)!;
    expect(missingPermissions(guild.members.me, ['ViewChannel', 'SendMessages'], channel)).toEqual(['SendMessages']);
    expect(missingPermissions(guild.members.me, ['ViewChannel', 'SendMessages'])).toEqual([]);
  });

  test('no bot member → everything counts as missing', () => {
    expect(missingPermissions(null, ['ViewChannel'])).toEqual(['ViewChannel']);
  });
});
