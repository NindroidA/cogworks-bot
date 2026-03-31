/**
 * Legacy Migration: Bait Channel IDs Backfill
 *
 * Ensures BaitChannelConfig.channelIds is populated from the original
 * single channelId field. This covers any edge cases not caught by
 * the SQL migration that originally added the column.
 */

import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import type { LegacyMigration } from '../legacyMigration';

export const baitChannelIdsBackfill: LegacyMigration = {
  id: 'bait-channel-ids-backfill',
  description: 'Backfill channelIds array from single channelId field',
  version: '3.0.0',

  async detect(guildId: string): Promise<boolean> {
    const repo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await repo.findOneBy({ guildId });

    if (!config) return false;

    // Needs migration if channelId is set but channelIds is empty/null
    return !!config.channelId && (!config.channelIds || config.channelIds.length === 0);
  },

  async migrate(guildId: string) {
    const repo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await repo.findOneBy({ guildId });

    if (!config || !config.channelId) {
      return {
        success: true,
        changes: 0,
        details: 'No config or channelId to backfill',
      };
    }

    config.channelIds = [config.channelId];
    await repo.save(config);

    return {
      success: true,
      changes: 1,
      details: `Set channelIds=[${config.channelId}] from channelId`,
    };
  },
};
