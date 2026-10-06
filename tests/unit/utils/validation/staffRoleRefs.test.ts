/**
 * Stored role references + private-channel overwrites (v3.16.11 regression).
 *
 * staff_roles.role and BotConfig.globalStaffRole hold either the raw snowflake
 * (canonical: dashboard, /bot-setup, /role add since v3.16.11) or a legacy
 * `<@&id>` mention. extractIdFromMention is the one parser for both.
 * createPrivateChannelPermissions must drop role IDs that no longer exist —
 * discord.js throws on an unresolvable overwrite ID, which used to block
 * every ticket/application channel in the guild after a stale row.
 */

import { describe, expect, test } from 'bun:test';
import { extractIdFromMention } from '../../../../src/utils';
import { createPrivateChannelPermissions, PermissionSets } from '../../../../src/utils/validation/permissionValidator';

const GUILD = '999999999999999999';
const STAFF = '123456789012345678';
const ADMIN = '223456789012345678';
const DELETED = '323456789012345678';
const USER = '423456789012345678';

describe('extractIdFromMention', () => {
  test('accepts the raw snowflake (canonical format)', () => {
    expect(extractIdFromMention(STAFF)).toBe(STAFF);
    expect(extractIdFromMention('12345678901234567890')).toBe('12345678901234567890');
  });

  test('accepts legacy role and user mentions', () => {
    expect(extractIdFromMention(`<@&${STAFF}>`)).toBe(STAFF);
    expect(extractIdFromMention(`<@${USER}>`)).toBe(USER);
  });

  test('rejects "@everyone", short numbers and junk', () => {
    expect(extractIdFromMention('@everyone')).toBeNull();
    expect(extractIdFromMention('12345')).toBeNull();
    expect(extractIdFromMention(`${STAFF}x`)).toBeNull();
    expect(extractIdFromMention(`<#${STAFF}>`)).toBeNull();
    expect(extractIdFromMention('')).toBeNull();
  });
});

describe('createPrivateChannelPermissions', () => {
  const ids = (overwrites: Array<{ id: string }>) => overwrites.map(o => o.id);

  test('denies @everyone, then allows users and roles', () => {
    const overwrites = createPrivateChannelPermissions(GUILD, [USER], [STAFF, ADMIN], PermissionSets.TICKET_CREATOR);
    expect(overwrites[0]).toEqual({ id: GUILD, deny: PermissionSets.DENY_ALL });
    expect(ids(overwrites)).toEqual([GUILD, USER, STAFF, ADMIN]);
    expect(overwrites[1].allow).toBe(PermissionSets.TICKET_CREATOR);
  });

  test('skips roles missing from the guild role cache (deleted while the bot was offline)', () => {
    const existing = new Set([GUILD, STAFF, ADMIN]);
    const overwrites = createPrivateChannelPermissions(
      GUILD,
      [USER],
      [STAFF, DELETED, ADMIN],
      PermissionSets.STAFF_MEMBER,
      existing,
    );
    expect(ids(overwrites)).toEqual([GUILD, USER, STAFF, ADMIN]);
  });

  test('de-duplicates roles and never re-allows @everyone', () => {
    const overwrites = createPrivateChannelPermissions(GUILD, [USER], [STAFF, STAFF, GUILD]);
    expect(ids(overwrites)).toEqual([GUILD, USER, STAFF]);
  });
});
