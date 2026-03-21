/**
 * Legacy Migration: Announcement Role Rename
 *
 * Copies minecraftRoleId to defaultRoleId when the new column exists
 * (added by Plan 04). This migration safely returns false from detect()
 * if the column doesn't exist yet.
 */

import { AppDataSource } from '../../../typeorm';
import type { LegacyMigration } from '../legacyMigration';

export const announcementRoleRename: LegacyMigration = {
  id: 'announcement-role-rename',
  description: 'Copy minecraftRoleId to defaultRoleId column',
  version: '3.0.0',

  async detect(guildId: string): Promise<boolean> {
    try {
      // Query raw to check if defaultRoleId column exists and needs backfill.
      // TypeORM will throw if the column doesn't exist yet (Plan 04 adds it).
      const rows = await AppDataSource.query(
        'SELECT `minecraftRoleId`, `defaultRoleId` FROM `announcement_config` WHERE `guildId` = ? LIMIT 1',
        [guildId],
      );

      if (!rows || rows.length === 0) return false;

      const row = rows[0];
      // Needs migration if minecraftRoleId is set but defaultRoleId is null/empty
      return !!row.minecraftRoleId && !row.defaultRoleId;
    } catch {
      // Column doesn't exist yet — nothing to migrate
      return false;
    }
  },

  async migrate(guildId: string) {
    try {
      const result = await AppDataSource.query(
        'UPDATE `announcement_config` SET `defaultRoleId` = `minecraftRoleId` WHERE `guildId` = ? AND `defaultRoleId` IS NULL AND `minecraftRoleId` IS NOT NULL',
        [guildId],
      );

      const affected = result?.affectedRows ?? 0;
      return {
        success: true,
        changes: affected,
        details: affected > 0 ? 'Copied minecraftRoleId to defaultRoleId' : 'No changes needed',
      };
    } catch {
      // Column doesn't exist — shouldn't reach here since detect() guards it
      return { success: true, changes: 0, details: 'defaultRoleId column not yet available' };
    }
  },
};
