import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Per-guild feature permission grant.
 *
 * One row = "role `roleId` in guild `guildId` has `level` access to `feature`".
 * Unconfigured guilds (no rows) fall back to the legacy admin-only behavior,
 * so adding this table is non-breaking.
 *
 * Uniqueness is enforced on `(guildId, feature, roleId)` so the API can treat
 * POST as an upsert — the same role can't have two different levels for the
 * same feature at the same time.
 */
@Entity({ name: 'guild_permissions' })
@Index(['guildId', 'feature'])
@Index(['guildId', 'feature', 'roleId'], { unique: true })
export class GuildPermission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  /**
   * Feature key. Validated against `FEATURES` in
   * `src/utils/validation/featurePermission.ts`. Stored as a plain string so
   * adding a feature doesn't require a migration.
   */
  @Column({ type: 'varchar', length: 64 })
  feature: string;

  @Column({ type: 'varchar', length: 255 })
  roleId: string;

  /**
   * Permission level — one of `admin`, `manage`, `use`. `none` is represented
   * by row absence, not by a stored value, so deleting a permission is the
   * canonical "revoke" action.
   */
  @Column({ type: 'varchar', length: 16, default: 'use' })
  level: string;
}
