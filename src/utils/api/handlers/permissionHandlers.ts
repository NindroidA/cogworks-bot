/**
 * Permission API handlers (v3.1.3).
 *
 * Guild-scoped CRUD for the `guild_permissions` table — these are the
 * endpoints the webapp's permissions UI consumes.
 *
 *   GET    /internal/guilds/:guildId/permissions      — list + feature/level catalog
 *   POST   /internal/guilds/:guildId/permissions      — upsert a (feature, roleId) grant
 *   DELETE /internal/guilds/:guildId/permissions/:id  — remove a grant by id
 *
 * POST is an upsert keyed on `(guildId, feature, roleId)` — writing the same
 * tuple twice updates the level rather than creating a duplicate. The DB
 * unique index enforces the same invariant if a concurrent write slips past
 * the application-level check.
 */

import type { Client } from 'discord.js';
import { GuildPermission } from '../../../typeorm/entities/GuildPermission';
import { lazyRepo } from '../../database/lazyRepo';
import {
  FEATURES,
  invalidateFeaturePermissionsCache,
  isFeature,
  isLevel,
  LEVELS,
} from '../../validation/featurePermission';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalString, requireId, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const permissionRepo = lazyRepo(GuildPermission);

/**
 * Resolve a role display name from the guild cache without throwing when the
 * guild / role isn't available (e.g. dashboard queries against a guild the
 * bot just left). Returns `null` instead of a placeholder so the webapp can
 * render its own "Deleted role" affordance.
 */
function lookupRoleName(client: Client, guildId: string, roleId: string): string | null {
  const guild = client.guilds.cache.get(guildId);
  return guild?.roles.cache.get(roleId)?.name ?? null;
}

function serialize(client: Client, guildId: string, row: GuildPermission) {
  return {
    id: row.id,
    feature: row.feature,
    roleId: row.roleId,
    roleName: lookupRoleName(client, guildId, row.roleId),
    level: row.level,
  };
}

export function registerPermissionHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // GET /internal/guilds/:guildId/permissions
  // Returns the guild's permission grants plus the feature/level catalog so
  // the webapp dropdowns stay in sync with the bot's source of truth.
  routes.set('GET /permissions', async guildId => {
    const rows = await permissionRepo.find({ where: { guildId }, order: { feature: 'ASC', level: 'DESC' } });
    return {
      permissions: rows.map(row => serialize(client, guildId, row)),
      features: [...FEATURES],
      levels: [...LEVELS],
    };
  });

  // POST /internal/guilds/:guildId/permissions
  // Upsert by (guildId, feature, roleId). Accepts a `triggeredBy` userId for
  // audit trail; returns the persisted row including the resolved roleName.
  routes.set('POST /permissions', async (guildId, body) => {
    const feature = requireString(body, 'feature');
    if (!isFeature(feature)) {
      throw ApiError.badRequest(`Unknown feature. Must be one of: ${FEATURES.join(', ')}`);
    }

    const roleId = requireString(body, 'roleId');
    if (!isValidSnowflake(roleId)) throw ApiError.badRequest('Invalid roleId format');

    const level = requireString(body, 'level');
    if (!isLevel(level)) {
      throw ApiError.badRequest(`Unknown level. Must be one of: ${LEVELS.join(', ')}`);
    }

    // Upsert keyed on (guildId, feature, roleId). The unique index on that
    // tuple is our belt-and-suspenders guarantee; the explicit lookup keeps
    // the response shape consistent (same `id` on subsequent edits).
    let row = await permissionRepo.findOneBy({ guildId, feature, roleId });
    if (row) {
      row.level = level;
      await permissionRepo.save(row);
    } else {
      row = permissionRepo.create({ guildId, feature, roleId, level });
      await permissionRepo.save(row);
    }

    invalidateFeaturePermissionsCache(guildId);

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'permission.upsert', triggeredBy, {
      id: row.id,
      feature,
      roleId,
      level,
    });

    return {
      success: true,
      permission: serialize(client, guildId, row),
    };
  });

  // DELETE /internal/guilds/:guildId/permissions/:id
  // Returns `{ success: true }` whether or not the row existed — the caller
  // ends up in the same state either way and idempotent deletes make the
  // webapp's confirm-modal flow easier.
  routes.set('DELETE /permissions/:id', async (guildId, body, url) => {
    const id = requireId(url, 'permissions');

    const row = await permissionRepo.findOneBy({ id, guildId });
    if (row) {
      await permissionRepo.remove(row);
      invalidateFeaturePermissionsCache(guildId);
    }

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'permission.delete', triggeredBy, {
      id,
      existed: Boolean(row),
    });

    return { success: true };
  });
}
