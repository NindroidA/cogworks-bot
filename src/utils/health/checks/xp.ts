/**
 * XP health checks (design inventory §3.7): XPConfig references and rates, and
 * role rewards. A disabled XP system isn't checked: none of its settings are
 * read until it's turned back on.
 */
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { resolveRole } from '../refs';
import type { HealthCheck, HealthFinding } from '../types';
import {
  assignableRoleFindings,
  botLacks,
  type ChannelRule,
  channelFindings,
  channelNames,
  MESSAGE_KINDS,
  prunableRefs,
  roleNames,
} from './featureRefs';

const config = defineCheck(
  {
    id: 'xp.config',
    system: 'xp',
    entities: ['XPConfig'],
    names: [
      ...channelNames('level_up_channel'),
      'ignored_channel_missing',
      'ignored_role_missing',
      'multiplier_channel_missing',
      'multiplier_invalid',
      'rate_inverted',
    ],
    isConfigured: ctx => rowsOf(ctx, 'XPConfig')[0]?.enabled === true,
  },
  (ctx, emit) => {
    const row = rowsOf(ctx, 'XPConfig')[0];
    if (!row?.enabled) return [];
    const at = (field: string): FindingTarget => ({ entity: 'XPConfig', rowId: row.id, field });
    const out: HealthFinding[] = [];
    // Level-ups post here (null = the message's own channel); a deleted one drops them silently.
    if (row.levelUpChannelId) {
      const rule: ChannelRule = { kinds: MESSAGE_KINDS, perms: ['ViewChannel', 'SendMessages'], severity: 'degraded' };
      out.push(...channelFindings(ctx, emit, 'level_up_channel', row.levelUpChannelId, at('levelUpChannelId'), rule));
    }
    out.push(
      ...prunableRefs(ctx, emit, 'ignored_channel_missing', 'channel', row.ignoredChannels, at('ignoredChannels')),
      ...prunableRefs(ctx, emit, 'ignored_role_missing', 'role', row.ignoredRoles, at('ignoredRoles')),
    );
    const multipliers = Object.entries(row.multiplierChannels ?? {});
    const ids = multipliers.map(([id]) => id);
    const deleted = prunableRefs(ctx, emit, 'multiplier_channel_missing', 'channel', ids, at('multiplierChannels'));
    out.push(...deleted);
    for (const [id, value] of multipliers) {
      // 0 is ignored and a negative value floors every message to 1 XP.
      if (Number(value) > 0 || deleted.some(f => f.refId === id)) continue;
      const params = { channelId: id, multiplier: String(value) };
      out.push(emit('multiplier_invalid', 'degraded', 'confirm', { ...at('multiplierChannels'), refId: id, params }));
    }
    if (row.xpPerMessageMin > row.xpPerMessageMax) {
      const params = { min: row.xpPerMessageMin, max: row.xpPerMessageMax };
      out.push(emit('rate_inverted', 'cosmetic', 'confirm', { ...at('xpPerMessageMin'), params }));
    }
    return out;
  },
);

const roleRewards = defineCheck(
  {
    id: 'xp.role_reward',
    system: 'xp',
    entities: ['XPConfig', 'XPRoleReward'],
    names: [...roleNames('role'), 'no_manage_roles', 'duplicate_level', 'too_many'],
    isConfigured: () => false,
  },
  (ctx, emit) => {
    if (!rowsOf(ctx, 'XPConfig')[0]?.enabled) return [];
    const rows = [...rowsOf(ctx, 'XPRoleReward')].sort((a, b) => a.id - b.id);
    const out: HealthFinding[] = [];
    const all: FindingTarget = { entity: 'XPRoleReward', params: { count: rows.length } };
    // /xp-setup stops at 25; the dashboard doesn't.
    if (rows.length > 25) out.push(emit('too_many', 'cosmetic', 'manual', all));
    // Grant failures are only debug-logged (xpMessageHandler), so members silently miss their rewards.
    if (rows.length > 0 && botLacks(ctx, 'ManageRoles')) out.push(emit('no_manage_roles', 'degraded', 'manual', all));
    const firstAtLevel = new Map<number, { id: number; roleId: string }>();
    for (const row of rows) {
      const { id, level } = row;
      const at: FindingTarget = { entity: 'XPRoleReward', rowId: id, field: 'roleId', params: { level } };
      // One reward per level is enforced by /xp-setup only (no unique index). Both are granted,
      // but `/xp-setup role-reward-remove` only ever removes the first. A reward whose role was
      // deleted is only role_missing: kept, it would make the live reward the one to remove.
      if (resolveRole(ctx.guild, row.roleId).status !== 'missing') {
        const kept = firstAtLevel.get(level);
        if (!kept) firstAtLevel.set(level, { id, roleId: row.roleId });
        else {
          const params = { level, roleId: row.roleId, keptRowId: kept.id, keptRoleId: kept.roleId };
          out.push(emit('duplicate_level', 'cosmetic', 'confirm', { ...at, field: 'level', params }));
        }
      }
      // roleDelete removes the reward when its role goes.
      out.push(...assignableRoleFindings(ctx, emit, 'role', row.roleId, at, { severity: 'cosmetic', repair: 'auto' }));
    }
    return out;
  },
);

export const XP_CHECKS: readonly HealthCheck[] = [config, roleRewards];
