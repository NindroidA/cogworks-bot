/**
 * Reaction-role health checks: menus (channel, message in deep mode, mode,
 * option count, Manage Roles) and options (role, emoji validity, emoji
 * uniqueness by identity), one pass and one or more fail cases each.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { optionEmojiKey } from '../../../../src/utils/health/checks/reactionRoles';
import { type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { ADMIN_BOT, codes, G, runChecks, withMessages } from './moderationHelpers';

const CHANNEL = '300000000000000001';
const FORUM = '300000000000000002';
const GONE = '300000000000000666';
const ROLE_A = '200000000000000001';
const ROLE_B = '200000000000000002';
const HIGH = '200000000000000003';
const DELETED_ROLE = '200000000000000666';
const MESSAGE = '400000000000000001';
const EMOJI_ID = '500000000000000001';

const guild = (init: FakeGuildInit = {}): FakeGuildInit => ({
  ...ADMIN_BOT,
  roles: [
    { id: ROLE_A, position: 2 },
    { id: ROLE_B, position: 3 },
    { id: HIGH, position: 50 },
  ],
  channels: [{ id: CHANNEL }, { id: FORUM, type: ChannelType.GuildForum }],
  ...init,
});
const option = (id: number, emoji: string, roleId = ROLE_A, sortOrder = id) => ({
  id,
  menuId: 1,
  emoji,
  roleId,
  description: null,
  sortOrder,
});
const menu = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  guildId: G,
  channelId: CHANNEL,
  messageId: MESSAGE,
  name: 'Colors',
  mode: 'normal',
  options: [option(1, '🔴', ROLE_A), option(2, `<:blue:${EMOJI_ID}>`, ROLE_B)],
  ...overrides,
});

describe('optionEmojiKey', () => {
  test('custom emoji by id in every spelling (bare id too); unicode by itself; text is invalid', () => {
    const spellings = [`<:blue:${EMOJI_ID}>`, `<a:blue:${EMOJI_ID}>`, `blue:${EMOJI_ID}`, `<:renamed:${EMOJI_ID}>`, ` ${EMOJI_ID} `];
    for (const spelling of spellings) expect(optionEmojiKey(spelling)).toBe(EMOJI_ID);
    expect(optionEmojiKey(' 🔴 ')).toBe('🔴');
    expect(optionEmojiKey('red')).toBeNull();
    expect(optionEmojiKey('1')).toBeNull();
    // Too short for a snowflake, and #53 doesn't strip brackets from a bare id.
    expect(optionEmojiKey('12345')).toBeNull();
    expect(optionEmojiKey(`<${EMOJI_ID}>`)).toBeNull();
  });
});

describe('reactionRole.menu', () => {
  const id = 'reactionRole.menu';

  test('pass: working menu, and no menus at all', async () => {
    expect(await runChecks(id, { ReactionRoleMenu: [menu()] }, guild())).toEqual([]);
    expect(await runChecks(id, { ReactionRoleMenu: [] }, guild({ botPermissions: [] }))).toEqual([]);
  });

  test('fail: deleted channel (confirm: the cleaner deletes the menu) or wrong type', async () => {
    const [gone] = await runChecks(id, { ReactionRoleMenu: [menu({ channelId: GONE })] }, guild());
    expect(gone).toMatchObject({
      code: 'reactionRole.menu.channel_missing',
      system: 'reactionRole',
      severity: 'block',
      repair: 'confirm',
      rowId: 1,
      refId: GONE,
      params: { name: 'Colors', channelId: GONE },
    });
    expect(codes(await runChecks(id, { ReactionRoleMenu: [menu({ channelId: FORUM })] }, guild()))).toEqual([
      'reactionRole.menu.channel_wrong_type',
    ]);
  });

  test('unique mode also needs Manage Messages (degraded); View Channel missing blocks', async () => {
    const base = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.AddReactions | PermissionFlagsBits.ReadMessageHistory;
    const g = guild({ channels: [{ id: CHANNEL, botPermissions: base }] });
    expect(await runChecks(id, { ReactionRoleMenu: [menu()] }, g)).toEqual([]);
    const [unique] = await runChecks(id, { ReactionRoleMenu: [menu({ mode: 'unique' })] }, g);
    expect(unique).toMatchObject({
      code: 'reactionRole.menu.channel_permissions',
      severity: 'degraded',
      params: { permissions: 'ManageMessages' },
    });
    const blind = guild({ channels: [{ id: CHANNEL, botPermissions: PermissionFlagsBits.AddReactions }] });
    const [blocked] = await runChecks(id, { ReactionRoleMenu: [menu()] }, blind);
    expect(blocked).toMatchObject({ severity: 'block', params: { permissions: 'ViewChannel, ReadMessageHistory' } });
  });

  test('message: missing only reported in deep mode', async () => {
    const g = makeFakeGuild(guild());
    withMessages(g, CHANNEL, []);
    expect(await runChecks(id, { ReactionRoleMenu: [menu()] }, g)).toEqual([]);
    const [f] = await runChecks(id, { ReactionRoleMenu: [menu()] }, g, { deep: true });
    expect(f).toMatchObject({ code: 'reactionRole.menu.message_missing', severity: 'block', repair: 'confirm' });
    withMessages(g, CHANNEL, [MESSAGE]);
    expect(await runChecks(id, { ReactionRoleMenu: [menu()] }, g, { deep: true })).toEqual([]);
  });

  test('deep mode: unique mode without Manage Messages still reports a deleted message', async () => {
    const base = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.AddReactions | PermissionFlagsBits.ReadMessageHistory;
    const g = makeFakeGuild(guild({ channels: [{ id: CHANNEL, botPermissions: base }] }));
    withMessages(g, CHANNEL, []);
    const findings = await runChecks(id, { ReactionRoleMenu: [menu({ mode: 'unique' })] }, g, { deep: true });
    expect(codes(findings)).toEqual(['reactionRole.menu.channel_permissions', 'reactionRole.menu.message_missing']);
    expect(findings.map(f => f.severity)).toEqual(['degraded', 'block']);
  });

  test('fail: unknown mode (behaves as normal, so auto), no options, more than 20 options', async () => {
    const [mode] = await runChecks(id, { ReactionRoleMenu: [menu({ mode: 'toggle' })] }, guild());
    expect(mode).toMatchObject({ code: 'reactionRole.menu.mode', severity: 'cosmetic', repair: 'auto', params: { mode: 'toggle' } });
    expect(codes(await runChecks(id, { ReactionRoleMenu: [menu({ options: [] })] }, guild()))).toEqual([
      'reactionRole.menu.no_options',
    ]);
    const many = Array.from({ length: 21 }, (_, i) => option(i + 1, '🔴'));
    const [tooMany] = await runChecks(id, { ReactionRoleMenu: [menu({ options: many })] }, guild());
    expect(tooMany).toMatchObject({ code: 'reactionRole.menu.too_many_options', params: { count: 21, max: 20 } });
    const twenty = many.slice(0, 20);
    expect(await runChecks(id, { ReactionRoleMenu: [menu({ options: twenty })] }, guild())).toEqual([]);
  });

  test('fail: the bot lacks Manage Roles (reported once, not per menu)', async () => {
    const perms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory];
    const findings = await runChecks(id, { ReactionRoleMenu: [menu(), menu({ id: 2 })] }, guild({ botPermissions: perms }));
    expect(codes(findings)).toEqual(['reactionRole.menu.manage_roles']);
  });
});

describe('reactionRole.option', () => {
  const id = 'reactionRole.option';

  test('pass: assignable roles and distinct emoji', async () => {
    expect(await runChecks(id, { ReactionRoleMenu: [menu()] }, guild())).toEqual([]);
  });

  test('fail: deleted role (auto: the roleDelete cleaner), @everyone, or above the bot', async () => {
    const opts = [option(1, '🔴', DELETED_ROLE), option(2, '🟢', G), option(3, '🔵', HIGH)];
    const findings = await runChecks(id, { ReactionRoleMenu: [menu({ options: opts })] }, guild());
    expect(codes(findings)).toEqual([
      'reactionRole.option.role_missing',
      'reactionRole.option.role_everyone',
      'reactionRole.option.role_too_high',
    ]);
    expect(findings[0]).toMatchObject({
      severity: 'block',
      repair: 'auto',
      entity: 'ReactionRoleOption',
      rowId: 1,
      refId: DELETED_ROLE,
      params: { menu: 'Colors', emoji: '🔴', roleId: DELETED_ROLE },
    });
    expect(findings[2]).toMatchObject({ repair: 'manual' });
  });

  test('fail: invalid emoji', async () => {
    const [f] = await runChecks(id, { ReactionRoleMenu: [menu({ options: [option(1, 'red')] })] }, guild());
    expect(f).toMatchObject({ code: 'reactionRole.option.emoji_invalid', severity: 'block', field: 'emoji' });
  });

  test('fail: two spellings of one custom emoji are a duplicate; the later option is reported', async () => {
    const opts = [option(5, `<a:blue:${EMOJI_ID}>`, ROLE_B, 2), option(4, `<:blue:${EMOJI_ID}>`, ROLE_A, 1)];
    const findings = await runChecks(id, { ReactionRoleMenu: [menu({ options: opts })] }, guild());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'reactionRole.option.emoji_duplicate',
      severity: 'degraded',
      repair: 'manual',
      rowId: 5,
      params: { emoji: `<a:blue:${EMOJI_ID}>`, keptEmoji: `<:blue:${EMOJI_ID}>` },
    });
  });

  test('a custom emoji saved as its bare id is valid, and the same emoji as <:x:id>', async () => {
    const alone = [option(1, '🔴'), option(2, EMOJI_ID, ROLE_B)];
    expect(await runChecks(id, { ReactionRoleMenu: [menu({ options: alone })] }, guild())).toEqual([]);
    const both = [option(1, `<:blue:${EMOJI_ID}>`), option(2, EMOJI_ID, ROLE_B)];
    const findings = await runChecks(id, { ReactionRoleMenu: [menu({ options: both })] }, guild());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'reactionRole.option.emoji_duplicate',
      rowId: 2,
      params: { emoji: EMOJI_ID, keptEmoji: `<:blue:${EMOJI_ID}>` },
    });
  });

  test('pass: the same emoji in two different menus', async () => {
    const other = menu({ id: 2, options: [option(9, '🔴', ROLE_B)] });
    expect(await runChecks(id, { ReactionRoleMenu: [menu(), other] }, guild())).toEqual([]);
  });
});
