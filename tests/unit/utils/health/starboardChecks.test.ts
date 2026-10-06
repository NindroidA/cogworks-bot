/**
 * Starboard health check: channel, emoji, threshold and ignored channels of an
 * enabled starboard.
 */
import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import { CATEGORY, codes, G, GONE_CHANNEL, guildInit, LOCKED, NEWS, runOne, TEXT, VOICE } from './communityFixtures';

const id = 'starboard.config';
const starboard = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  guildId: G,
  enabled: true,
  channelId: TEXT,
  emoji: '⭐',
  threshold: 3,
  ignoredChannels: [VOICE],
  ...overrides,
});
const run = (overrides: Record<string, unknown> = {}) => runOne(id, { StarboardConfig: [starboard(overrides)] });

describe('starboard.config', () => {
  test('pass: enabled starboard with valid settings, including custom and bare-name emoji', async () => {
    expect(await run()).toEqual([]);
    expect(await run({ channelId: NEWS, emoji: '<:star2:123456789012345678>', ignoredChannels: null })).toEqual([]);
    expect(await run({ emoji: '<a:spin:123456789012345678>' })).toEqual([]);
    expect(await run({ emoji: 'gold_star' })).toEqual([]);
  });

  test('pass: multi-codepoint unicode emoji (flags, skin tones, keycaps, ZWJ and tag sequences)', async () => {
    const emoji = ['🇺🇸', '🇦', '👍🏽', '🏽', '1️⃣', '#️⃣', '❤️', '❤', '👨🏽‍💻', '🏳️‍🌈', '❤️‍🔥', '🫱🏻‍🫲🏿', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'];
    for (const e of emoji) expect({ e, findings: await run({ emoji: e }) }).toEqual({ e, findings: [] });
  });

  test('pass: a disabled starboard (what channelDelete leaves) is not checked', async () => {
    expect(await run({ enabled: false, channelId: '' })).toEqual([]);
  });

  test('fail: enabled without a channel', async () => {
    const [f] = await run({ channelId: '' });
    expect(f).toMatchObject({
      code: 'starboard.config.channel_unset',
      system: 'starboard',
      severity: 'block',
      repair: 'manual',
    });
  });

  test('fail: deleted channel blocks the starboard (auto: the cleaner turns it off)', async () => {
    const [f] = await run({ channelId: GONE_CHANNEL });
    expect(f).toMatchObject({
      code: 'starboard.config.channel_missing',
      severity: 'block',
      repair: 'auto',
      refId: GONE_CHANNEL,
    });
  });

  test('fail: wrong channel type; missing post permissions block, missing history only degrades', async () => {
    expect(codes(await run({ channelId: CATEGORY }))).toEqual(['starboard.config.channel_wrong_type']);
    const [post, history] = await run({ channelId: LOCKED });
    expect(post).toMatchObject({
      code: 'starboard.config.channel_permissions',
      severity: 'block',
      repair: 'manual',
      params: { channelId: LOCKED, permissions: 'Send Messages, Embed Links' },
    });
    expect(history).toMatchObject({ code: 'starboard.config.channel_history', severity: 'degraded' });
  });

  test('fail: only Read Message History missing is degraded (new posts still go out)', async () => {
    const NO_HISTORY = '300000000000000008';
    const perms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    const guild = { channels: [...(guildInit().channels ?? []), { id: NO_HISTORY, botPermissions: perms }] };
    const findings = await runOne(id, { StarboardConfig: [starboard({ channelId: NO_HISTORY })] }, guild);
    expect(findings).toEqual([
      {
        code: 'starboard.config.channel_history',
        system: 'starboard',
        severity: 'degraded',
        repair: 'manual',
        entity: 'StarboardConfig',
        rowId: 1,
        field: 'channelId',
        refId: NO_HISTORY,
        params: { channelId: NO_HISTORY, permissions: 'Read Message History' },
      },
    ]);
  });

  test('fail: an emoji no reaction can match', async () => {
    for (const emoji of ['not an emoji', ':star:', '⭐⭐', '⭐ ', '1', '<:broken>', '<:x:123456789012345678>', '']) {
      const [f] = await run({ emoji });
      expect(f).toMatchObject({ code: 'starboard.config.emoji_invalid', severity: 'block', params: { emoji } });
    }
  });

  test('fail: threshold below 1; pass: 1', async () => {
    const [f] = await run({ threshold: 0 });
    expect(f).toMatchObject({
      code: 'starboard.config.threshold_invalid',
      severity: 'degraded',
      repair: 'confirm',
      params: { threshold: '0' },
    });
    expect(await run({ threshold: 1 })).toEqual([]);
  });

  test('fail: deleted ignored channel is prunable', async () => {
    const [f] = await run({ ignoredChannels: [VOICE, GONE_CHANNEL] });
    expect(f).toMatchObject({
      code: 'starboard.config.ignored_channel_missing',
      severity: 'cosmetic',
      repair: 'auto',
      refId: GONE_CHANNEL,
    });
  });
});
