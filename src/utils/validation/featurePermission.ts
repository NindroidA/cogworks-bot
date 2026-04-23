/**
 * Feature-based permission checker (v3.1.3).
 *
 * Layers on top of the legacy `requireAdmin` path. Semantics:
 *
 *   1. If the member has Discord's Administrator permission, they always pass.
 *      This prevents anyone from locking themselves out and keeps `/bot-setup`
 *      etc. working with zero configuration.
 *   2. If the guild has zero `guild_permissions` rows, we fall back to the
 *      legacy admin-only behavior — the feature requires Discord admin.
 *      Adding this table is therefore non-breaking; a guild that never visits
 *      the webapp's permissions UI behaves exactly like pre-v3.1.3.
 *   3. Otherwise, the member's roles are checked against the guild's
 *      permission rows. The highest level granted by any of the member's
 *      roles is compared against `requiredLevel`. If it meets or exceeds the
 *      requirement, access is allowed.
 *
 * Cached for `CACHE_TTL_MS` to avoid a DB hit per command. Writes invalidate
 * the cache via `invalidateFeaturePermissionsCache(guildId)`.
 */

import type { GuildMember, Interaction } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { GuildPermission } from '../../typeorm/entities/GuildPermission';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

// ---------------------------------------------------------------------------
// Feature + level taxonomy
// ---------------------------------------------------------------------------

/**
 * Allow-list of feature keys. Adding a new feature requires:
 *   1) appending the key here
 *   2) calling `guardFeatureAccess(interaction, 'newFeature', level)` from
 *      the relevant handlers (incrementally)
 *   3) surfacing it in the webapp's feature dropdown (contract is the API
 *      response — it returns this array verbatim)
 */
export const FEATURES = [
  'tickets',
  'announcements',
  'baitchannel',
  'memory',
  'xp',
  'starboard',
  'events',
  'reactionroles',
  'onboarding',
  'automod',
  'rules',
  'analytics',
] as const;
export type Feature = (typeof FEATURES)[number];

export function isFeature(value: unknown): value is Feature {
  return typeof value === 'string' && (FEATURES as readonly string[]).includes(value);
}

/** Permission levels, lowest-to-highest. `none` is implicit (no row). */
export const LEVELS = ['use', 'manage', 'admin'] as const;
export type Level = (typeof LEVELS)[number];

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

const LEVEL_RANK: Record<Level, number> = {
  use: 1,
  manage: 2,
  admin: 3,
};

/**
 * Does the member's effective level satisfy the requirement? Higher levels
 * always satisfy lower ones — an `admin` grant covers `manage` and `use`.
 */
export function levelMeets(granted: Level, required: Level): boolean {
  return LEVEL_RANK[granted] >= LEVEL_RANK[required];
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  rows: GuildPermission[];
  expires: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Drop cached permission rows for a guild. Call after any write to
 * `guild_permissions` so the next check reflects the change immediately.
 */
export function invalidateFeaturePermissionsCache(guildId?: string): void {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

async function getGuildPermissions(guildId: string): Promise<GuildPermission[]> {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expires > now) return cached.rows;

  try {
    const repo = AppDataSource.getRepository(GuildPermission);
    const rows = await repo.find({ where: { guildId } });
    cache.set(guildId, { rows, expires: now + CACHE_TTL_MS });
    return rows;
  } catch (error) {
    // DB hiccup should not lock users out — fall back to "no custom perms"
    // which preserves the admin-only behavior. Log so it's visible.
    enhancedLogger.warn('featurePermission: DB lookup failed, falling back to admin-only', LogCategory.SECURITY, {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pure level resolver — testable without Discord/DB
// ---------------------------------------------------------------------------

/**
 * Resolve the effective level for a member against a list of permission rows
 * for a single feature. Picks the highest level across matching role IDs;
 * returns `null` if none of the member's roles have any grant.
 *
 * Exported for unit tests — the business logic of "which roles confer what"
 * lives here and deserves coverage without spinning up a Discord client.
 */
export function resolveMemberLevel(memberRoleIds: readonly string[], rows: readonly GuildPermission[]): Level | null {
  const roleSet = new Set(memberRoleIds);
  let best: Level | null = null;
  for (const row of rows) {
    if (!roleSet.has(row.roleId)) continue;
    if (!isLevel(row.level)) continue;
    if (best === null || LEVEL_RANK[row.level] > LEVEL_RANK[best]) {
      best = row.level;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FeatureAccessResult {
  allowed: boolean;
  /** User-facing message when denied. Absent on success. */
  message?: string;
  /** Why the grant was decided — useful for diagnostics and auditing. */
  reason:
    | 'discord-admin'
    | 'no-config-fallback'
    | 'role-grant'
    | 'no-matching-role'
    | 'insufficient-level'
    | 'no-guild';
  /** Effective level, if resolved. `null` when denied or when discord-admin path fired. */
  level: Level | null;
}

/**
 * Check whether an interaction's user has at least `requiredLevel` access
 * to `feature` in the guild where the interaction occurred.
 *
 * Never throws — on any internal failure it returns `{ allowed: false }`
 * with a generic message. The underlying cause is logged.
 */
export async function hasFeatureAccess(
  interaction: Interaction,
  feature: Feature,
  requiredLevel: Level,
): Promise<FeatureAccessResult> {
  if (!interaction.guild || !interaction.guildId) {
    return {
      allowed: false,
      message: '❌ This command can only be used in a server.',
      reason: 'no-guild',
      level: null,
    };
  }

  const member = interaction.member as GuildMember | null;

  // (1) Discord Administrator always wins — cannot lock yourself out.
  if (member?.permissions?.has?.(PermissionsBitField.Flags.Administrator)) {
    return { allowed: true, reason: 'discord-admin', level: null };
  }

  // (2) No configured rows anywhere for this guild → legacy admin-only.
  const rows = await getGuildPermissions(interaction.guildId);
  if (rows.length === 0) {
    return {
      allowed: false,
      message: '❌ This command requires **Administrator** permission.',
      reason: 'no-config-fallback',
      level: null,
    };
  }

  // (3) Resolve effective level from matching rows.
  const memberRoleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
  const featureRows = rows.filter(r => r.feature === feature);
  const effective = resolveMemberLevel(memberRoleIds, featureRows);

  if (effective === null) {
    return {
      allowed: false,
      message: `❌ You don't have permission to use the **${feature}** feature.`,
      reason: 'no-matching-role',
      level: null,
    };
  }

  if (!levelMeets(effective, requiredLevel)) {
    return {
      allowed: false,
      message: `❌ This action requires at least **${requiredLevel}** access to the **${feature}** feature.`,
      reason: 'insufficient-level',
      level: effective,
    };
  }

  return { allowed: true, reason: 'role-grant', level: effective };
}

// ---------------------------------------------------------------------------
// Introspection for tests + /bot-setup UI
// ---------------------------------------------------------------------------

export const __testing = {
  LEVEL_RANK,
  getCacheSize: () => cache.size,
};
