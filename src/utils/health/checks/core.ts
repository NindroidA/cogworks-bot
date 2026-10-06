/**
 * Core health checks (design inventory §3.1): BotConfig, StaffRole,
 * GuildPermission and SetupState. Database plus guild cache only, no REST.
 */
import { isSupportedLocale } from '../../../lang';
import { DEFAULT_SYSTEM_STATES } from '../../../typeorm/entities/SetupState';
import { isFeature, isLevel } from '../../validation/featurePermission';
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { missingPermissions, parseRoleRef, resolveRole } from '../refs';
import type { HealthCheck, HealthFinding } from '../types';

const globalStaffRole = defineCheck(
  {
    id: 'core.global_staff_role',
    system: 'core',
    entities: ['BotConfig'],
    names: ['enabled_without_role', 'invalid', 'missing', 'format_legacy', 'not_mentionable'],
  },
  (ctx, emit) => {
    const config = rowsOf(ctx, 'BotConfig')[0];
    if (!config) return [];
    const at: FindingTarget = { entity: 'BotConfig', rowId: config.guildId, field: 'globalStaffRole' };
    if (!config.globalStaffRole) {
      if (!config.enableGlobalStaffRole) return [];
      return [emit('enabled_without_role', 'cosmetic', 'auto', { ...at, field: 'enableGlobalStaffRole' })];
    }
    const ref = parseRoleRef(config.globalStaffRole);
    if (!ref) return [emit('invalid', 'degraded', 'manual', at)];

    const target: FindingTarget = { ...at, refId: ref.id, params: { roleId: ref.id } };
    const role = resolveRole(ctx.guild, ref.id);
    // The repair nulls a deleted role, so its stored format no longer matters.
    if (role.status === 'missing') return [emit('missing', 'degraded', 'auto', target)];
    const out: HealthFinding[] = [];
    if (ref.legacy) out.push(emit('format_legacy', 'cosmetic', 'auto', target));
    // The new-ticket ping only fires with the flag on; pinging a non-mentionable role needs MentionEveryone.
    const pingFails =
      role.status === 'ok' &&
      config.enableGlobalStaffRole &&
      !role.value.mentionable &&
      ctx.me !== null &&
      missingPermissions(ctx.me, ['MentionEveryone']).length > 0;
    if (pingFails) out.push(emit('not_mentionable', 'degraded', 'manual', target));
    return out;
  },
);

const locale = defineCheck(
  { id: 'core.locale', system: 'core', entities: ['BotConfig'], names: ['unsupported'] },
  (ctx, emit) => {
    const config = rowsOf(ctx, 'BotConfig')[0];
    if (!config || isSupportedLocale(config.locale)) return [];
    const at: FindingTarget = { entity: 'BotConfig', rowId: config.guildId, field: 'locale' };
    return [emit('unsupported', 'cosmetic', 'auto', { ...at, params: { locale: String(config.locale) } })];
  },
);

const staffRoles = defineCheck(
  {
    id: 'core.staff_role',
    system: 'core',
    entities: ['StaffRole'],
    names: ['unknown_type', 'invalid', 'duplicate', 'missing', 'format_legacy'],
  },
  (ctx, emit) => {
    const out: HealthFinding[] = [];
    // Oldest row wins a duplicate pair, so the report is stable across runs.
    const rows = [...rowsOf(ctx, 'StaffRole')].sort((a, b) => a.id - b.id);
    const kept = new Map<string, number>();
    for (const row of rows) {
      const at: FindingTarget = { entity: 'StaffRole', rowId: row.id, field: 'role' };
      if (row.type !== 'staff' && row.type !== 'admin') {
        out.push(
          emit('unknown_type', 'degraded', 'manual', { ...at, field: 'type', params: { type: String(row.type) } }),
        );
      }
      const ref = parseRoleRef(row.role);
      if (!ref) {
        out.push(emit('invalid', 'degraded', 'manual', { ...at, params: { alias: row.alias ?? '' } }));
        continue;
      }
      const target: FindingTarget = { ...at, refId: ref.id, params: { roleId: ref.id, alias: row.alias ?? '' } };
      const key = `${row.type}:${ref.id}`;
      const keptRowId = kept.get(key);
      if (keptRowId !== undefined) {
        // The same role saved twice, usually once per format (`<@&id>` and raw).
        out.push(emit('duplicate', 'cosmetic', 'auto', { ...target, params: { ...target.params, keptRowId } }));
        continue;
      }
      kept.set(key, row.id);
      // A deleted staff role makes ticket and application channel creation throw.
      if (resolveRole(ctx.guild, ref.id).status === 'missing') out.push(emit('missing', 'block', 'auto', target));
      else if (ref.legacy) out.push(emit('format_legacy', 'cosmetic', 'auto', target));
    }
    return out;
  },
);

const guildPermissions = defineCheck(
  {
    id: 'core.guild_permission',
    system: 'core',
    entities: ['GuildPermission'],
    names: ['unknown_feature', 'unknown_level', 'everyone', 'missing_role'],
  },
  (ctx, emit) => {
    const out: HealthFinding[] = [];
    for (const row of rowsOf(ctx, 'GuildPermission')) {
      const params = { feature: row.feature, level: row.level, roleId: row.roleId };
      const at: FindingTarget = { entity: 'GuildPermission', rowId: row.id, params };
      if (!isFeature(row.feature)) out.push(emit('unknown_feature', 'cosmetic', 'auto', { ...at, field: 'feature' }));
      if (!isLevel(row.level)) out.push(emit('unknown_level', 'cosmetic', 'auto', { ...at, field: 'level' }));
      const ref: FindingTarget = { ...at, field: 'roleId', refId: row.roleId };
      // The @everyone role's id is the guild id: the grant gives every member this level.
      if (row.roleId === ctx.guildId) out.push(emit('everyone', 'degraded', 'manual', ref));
      else if (resolveRole(ctx.guild, row.roleId).status === 'missing')
        out.push(emit('missing_role', 'cosmetic', 'auto', ref));
    }
    return out;
  },
);

const SETUP_SYSTEM_IDS = new Set(Object.keys(DEFAULT_SYSTEM_STATES));

const setupState = defineCheck(
  { id: 'core.setup_state', system: 'core', entities: ['SetupState'], names: ['unknown_system'] },
  (ctx, emit) => {
    const state = rowsOf(ctx, 'SetupState')[0];
    // A JSON column the dashboard API writes without validation, so don't trust its shape.
    const selected: unknown = state?.selectedSystems;
    if (!state || !Array.isArray(selected)) return [];
    const at: FindingTarget = { entity: 'SetupState', rowId: state.id, field: 'selectedSystems' };
    return selected
      .filter(id => !SETUP_SYSTEM_IDS.has(String(id)))
      .map(id => emit('unknown_system', 'cosmetic', 'auto', { ...at, params: { systemId: String(id) } }));
  },
);

export const CORE_CHECKS: readonly HealthCheck[] = [globalStaffRole, locale, staffRoles, guildPermissions, setupState];
