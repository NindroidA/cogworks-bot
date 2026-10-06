/**
 * Rules health check: channel, message (deep mode), role and emoji, one pass
 * and one or more fail cases each.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { ADMIN_BOT, codes, G, runChecks, withMessages } from './moderationHelpers';

const id = 'rules.config';
const CHANNEL = '300000000000000001';
const VOICE = '300000000000000002';
const FORUM = '300000000000000003';
const GONE = '300000000000000666';
const ROLE = '200000000000000001';
const HIGH = '200000000000000002';
const MANAGED = '200000000000000003';
const DELETED_ROLE = '200000000000000666';
const MESSAGE = '400000000000000001';

const guild = (init: FakeGuildInit = {}): FakeGuildInit => ({
  ...ADMIN_BOT,
  roles: [
    { id: ROLE, position: 2 },
    { id: HIGH, position: 50 },
    { id: MANAGED, position: 2, managed: true },
  ],
  channels: [
    { id: CHANNEL },
    { id: VOICE, type: ChannelType.GuildVoice },
    { id: FORUM, type: ChannelType.GuildForum },
  ],
  ...init,
});
const config = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  guildId: G,
  channelId: CHANNEL,
  messageId: MESSAGE,
  roleId: ROLE,
  emoji: '✅',
  ...overrides,
});

describe('rules.config', () => {
  test('pass: working setup, and no row means nothing to check', async () => {
    expect(await runChecks(id, { RulesConfig: [config()] }, guild())).toEqual([]);
    expect(await runChecks(id, { RulesConfig: [] }, guild())).toEqual([]);
  });

  test('fail: deleted channel blocks and needs confirmation (the cleaner deletes the config)', async () => {
    const [f] = await runChecks(id, { RulesConfig: [config({ channelId: GONE })] }, guild());
    expect(f).toMatchObject({
      code: 'rules.config.channel_missing',
      system: 'rules',
      severity: 'block',
      repair: 'confirm',
      entity: 'RulesConfig',
      rowId: 1,
      field: 'channelId',
      refId: GONE,
      params: { channelId: GONE },
    });
  });

  test('channel type: the text chat of a voice channel works (the dashboard offers it); a forum does not', async () => {
    expect(await runChecks(id, { RulesConfig: [config({ channelId: VOICE })] }, guild())).toEqual([]);
    expect(codes(await runChecks(id, { RulesConfig: [config({ channelId: FORUM })] }, guild()))).toEqual([
      'rules.config.channel_wrong_type',
    ]);
  });

  test('channel permissions: Read Message History blocks, Add Reactions only degrades', async () => {
    const view = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
    const noHistory = guild({ channels: [{ id: CHANNEL, botPermissions: view | PermissionFlagsBits.AddReactions }] });
    const [blocked] = await runChecks(id, { RulesConfig: [config()] }, noHistory);
    expect(blocked).toMatchObject({
      code: 'rules.config.channel_permissions',
      severity: 'block',
      repair: 'manual',
      params: { permissions: 'ReadMessageHistory' },
    });
    const noReact = guild({ channels: [{ id: CHANNEL, botPermissions: view | PermissionFlagsBits.ReadMessageHistory }] });
    const [degraded] = await runChecks(id, { RulesConfig: [config()] }, noReact);
    expect(degraded).toMatchObject({ severity: 'degraded', params: { permissions: 'AddReactions' } });
  });

  test('message: checked only in deep mode', async () => {
    const quick = makeFakeGuild(guild());
    const notFetched = withMessages(quick, CHANNEL, []);
    expect(await runChecks(id, { RulesConfig: [config()] }, quick)).toEqual([]);
    expect(notFetched).toEqual([]);

    const deep = makeFakeGuild(guild());
    withMessages(deep, CHANNEL, [MESSAGE]);
    expect(await runChecks(id, { RulesConfig: [config()] }, deep, { deep: true })).toEqual([]);
    withMessages(deep, CHANNEL, []);
    const [f] = await runChecks(id, { RulesConfig: [config()] }, deep, { deep: true });
    expect(f).toMatchObject({ code: 'rules.config.message_missing', severity: 'block', repair: 'confirm', refId: MESSAGE });
  });

  test('deep mode: missing Add Reactions does not hide a deleted message; missing Read Message History does', async () => {
    const view = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
    const noReact = makeFakeGuild(guild({ channels: [{ id: CHANNEL, botPermissions: view | PermissionFlagsBits.ReadMessageHistory }] }));
    withMessages(noReact, CHANNEL, []);
    const both = await runChecks(id, { RulesConfig: [config()] }, noReact, { deep: true });
    expect(codes(both)).toEqual(['rules.config.channel_permissions', 'rules.config.message_missing']);
    expect(both.map(f => f.severity)).toEqual(['degraded', 'block']);

    const noHistory = makeFakeGuild(guild({ channels: [{ id: CHANNEL, botPermissions: view | PermissionFlagsBits.AddReactions }] }));
    const fetched = withMessages(noHistory, CHANNEL, []);
    const only = await runChecks(id, { RulesConfig: [config()] }, noHistory, { deep: true });
    expect(codes(only)).toEqual(['rules.config.channel_permissions']);
    expect(fetched).toEqual([]);
  });

  test('fail: role deleted, @everyone, managed, or above the bot', async () => {
    const roleCode = async (roleId: string) => codes(await runChecks(id, { RulesConfig: [config({ roleId })] }, guild()));
    expect(await roleCode(DELETED_ROLE)).toEqual(['rules.config.role_missing']);
    expect(await roleCode(G)).toEqual(['rules.config.role_everyone']);
    expect(await roleCode(MANAGED)).toEqual(['rules.config.role_managed']);
    expect(await roleCode(HIGH)).toEqual(['rules.config.role_too_high']);
  });

  test('fail: the bot lacks Manage Roles', async () => {
    const perms = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    const findings = await runChecks(id, { RulesConfig: [config()] }, guild({ botPermissions: perms }));
    expect(codes(findings)).toEqual(['rules.config.manage_roles']);
    expect(findings[0]).toMatchObject({ severity: 'block', repair: 'manual', refId: ROLE });
  });

  test('emoji: unicode (incl. flags, keycaps, skin tones) and full custom form pass; text and bare name:id fail', async () => {
    const valid = ['✅', '🇺🇸', '1\uFE0F\u20E3', '👍\u{1F3FD}', '<:ok:500000000000000001>', '<a:ok:500000000000000001>'];
    for (const emoji of valid) {
      expect(await runChecks(id, { RulesConfig: [config({ emoji })] }, guild())).toEqual([]);
    }
    // Digits, # and * are emoji components, but on their own they are text.
    for (const emoji of ['check', 'ok:500000000000000001', '1', '#', '*']) {
      const [f] = await runChecks(id, { RulesConfig: [config({ emoji })] }, guild());
      expect(f).toMatchObject({ code: 'rules.config.emoji_invalid', severity: 'block', params: { emoji } });
    }
  });
});
