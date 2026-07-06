/**
 * Bait channel list helpers — single source of truth for the
 * `channelIds` (multi-channel) / `channelId` (legacy) column pair.
 *
 * The v3.1.35 multi-channel migration left both columns live: detection
 * prefers `channelIds` while older rows may only carry `channelId`. Every
 * reader must use `getBaitChannelIds` (uniform fallback) and every writer
 * must use `setBaitChannels` (dual-write) so the two columns can never
 * diverge again. Stage B (column retirement) is deferred until ninsys-api
 * gains `channelIds`.
 */

import type { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';

type BaitChannelColumns = Pick<BaitChannelConfig, 'channelId' | 'channelIds'>;

/**
 * Effective bait channel list: `channelIds` when non-empty, else the legacy
 * `channelId` as a one-element list, else empty. Returns a fresh array —
 * callers may mutate it freely.
 */
export function getBaitChannelIds(config: BaitChannelColumns): string[] {
  if (config.channelIds?.length) return [...config.channelIds];
  return config.channelId ? [config.channelId] : [];
}

/**
 * Write the bait channel list to BOTH columns (the caller still saves).
 * Dedupes while preserving order; `ids[0]` becomes the legacy primary.
 * An empty list normalizes to `channelIds = null` (not `[]`) — simple-array
 * hydrates '' back as `['']` otherwise — and `channelId = ''` to match the
 * non-nullable column's "unset" convention used across the codebase.
 */
export function setBaitChannels(config: BaitChannelColumns, ids: string[]): void {
  const deduped = [...new Set(ids)].filter(Boolean);
  config.channelIds = deduped.length > 0 ? deduped : null;
  config.channelId = deduped[0] ?? '';
}
