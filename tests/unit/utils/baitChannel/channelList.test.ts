/**
 * channelList Unit Tests
 *
 * `getBaitChannelIds` / `setBaitChannels` are the single owner of the
 * `channelIds` (multi-channel) / `channelId` (legacy) column pair. The
 * v3.15.3 live bug was `/baitchannel setup` writing ONLY the legacy column
 * while detection preferred `channelIds` — these helpers exist so readers
 * and writers can never diverge again.
 */

import { describe, expect, test } from 'bun:test';
import { getBaitChannelIds, setBaitChannels } from '../../../../src/utils/baitChannel/channelList';

describe('getBaitChannelIds', () => {
  test('prefers channelIds when non-empty (stale legacy column is ignored)', () => {
    const config = { channelId: 'stale-legacy', channelIds: ['a', 'b'] };
    expect(getBaitChannelIds(config)).toEqual(['a', 'b']);
  });

  test('falls back to legacy channelId when channelIds is null', () => {
    const config = { channelId: 'legacy-1', channelIds: null };
    expect(getBaitChannelIds(config)).toEqual(['legacy-1']);
  });

  test('falls back to legacy channelId when channelIds is empty', () => {
    const config = { channelId: 'legacy-1', channelIds: [] };
    expect(getBaitChannelIds(config)).toEqual(['legacy-1']);
  });

  test('returns empty list when both columns are unset', () => {
    expect(getBaitChannelIds({ channelId: '', channelIds: null })).toEqual([]);
  });

  test('returns a fresh array — mutating the result must not touch the config', () => {
    const config = { channelId: 'a', channelIds: ['a', 'b'] };
    const ids = getBaitChannelIds(config);
    ids.push('c');
    expect(config.channelIds).toEqual(['a', 'b']);
  });
});

describe('setBaitChannels', () => {
  test('dual-writes: channelIds gets the list, legacy channelId gets the primary', () => {
    const config = { channelId: '', channelIds: null as string[] | null };
    setBaitChannels(config, ['a', 'b']);
    expect(config.channelIds).toEqual(['a', 'b']);
    expect(config.channelId).toBe('a');
  });

  test('dedupes while preserving order', () => {
    const config = { channelId: '', channelIds: null as string[] | null };
    setBaitChannels(config, ['a', 'b', 'a']);
    expect(config.channelIds).toEqual(['a', 'b']);
    expect(config.channelId).toBe('a');
  });

  test('empty list normalizes to channelIds=null and channelId=""', () => {
    const config = { channelId: 'old', channelIds: ['old'] as string[] | null };
    setBaitChannels(config, []);
    expect(config.channelIds).toBeNull();
    expect(config.channelId).toBe('');
  });

  test('drops empty-string ids (simple-array hydration quirk)', () => {
    const config = { channelId: 'old', channelIds: ['old'] as string[] | null };
    setBaitChannels(config, ['']);
    expect(config.channelIds).toBeNull();
    expect(config.channelId).toBe('');
  });

  test('round-trips through getBaitChannelIds', () => {
    const config = { channelId: '', channelIds: null as string[] | null };
    setBaitChannels(config, ['x', 'y', 'z']);
    expect(getBaitChannelIds(config)).toEqual(['x', 'y', 'z']);
  });
});
