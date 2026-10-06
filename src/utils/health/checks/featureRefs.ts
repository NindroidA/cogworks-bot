/**
 * Reference rules shared by the community feature checks: a stored channel the
 * bot posts in, a role the bot grants, and lists of ids to prune. Only `missing`
 * is proof of deletion; inaccessible or unknown lookups yield no finding.
 */
import { validateRoleForMenu } from '../../reactionRole/menuBuilder';
import type { CheckContext } from '../context';
import type { Emit, FindingTarget } from '../define';
import {
  type ChannelKind,
  channelIsKind,
  missingPermissions,
  type PermissionName,
  resolveChannel,
  resolveRole,
} from '../refs';
import type { HealthFinding, HealthSeverity, RepairClass } from '../types';

/** Channel kinds that hold messages (voice and stage channels have a text chat). */
export const MESSAGE_KINDS: readonly ChannelKind[] = ['text', 'news', 'voice', 'stage'];
/** What a channel the bot posts embeds in needs. */
export const EMBED_SEND: readonly PermissionName[] = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

export interface ChannelRule {
  kinds: readonly ChannelKind[];
  perms: readonly PermissionName[];
  severity: HealthSeverity;
  /** The id may be a thread: archived ones aren't cached, so a cache miss is not proof of deletion. */
  mayBeThread?: boolean;
}

type ChannelNames<P extends string> = `${P}_missing` | `${P}_wrong_type` | `${P}_permissions`;
type RoleNames<P extends string> = `${P}_missing` | `${P}_unassignable` | `${P}_above_bot`;

/** Finding names for one channel setting, for a check's `names`. */
export const channelNames = <P extends string>(p: P): ChannelNames<P>[] => [
  `${p}_missing`,
  `${p}_wrong_type`,
  `${p}_permissions`,
];
/** Finding names for one granted role, for a check's `names`. */
export const roleNames = <P extends string>(p: P): RoleNames<P>[] => [
  `${p}_missing`,
  `${p}_unassignable`,
  `${p}_above_bot`,
];

/** True when the bot member is known and lacks the guild-level permission. */
export function botLacks(ctx: CheckContext, permission: PermissionName): boolean {
  return ctx.me !== null && missingPermissions(ctx.me, [permission]).length > 0;
}

/**
 * `<prefix>_missing` (auto: the channelDelete cleaner clears the column),
 * `_wrong_type`, or `_permissions` (lists what the bot lacks there). With
 * `rule.mayBeThread` a cache miss reads unknown, so `_missing` needs other proof.
 */
export function channelFindings<P extends string>(
  ctx: CheckContext,
  emit: Emit<NoInfer<ChannelNames<P>>>,
  prefix: P,
  id: string,
  at: FindingTarget,
  rule: ChannelRule,
): HealthFinding[] {
  const target: FindingTarget = { ...at, refId: id, params: { ...at.params, channelId: id } };
  const ref = resolveChannel(ctx.guild, id, rule);
  if (ref.status === 'missing') return [emit(`${prefix}_missing`, rule.severity, 'auto', target)];
  if (ref.status !== 'ok') return [];
  if (!channelIsKind(ref.value, ...rule.kinds)) return [emit(`${prefix}_wrong_type`, rule.severity, 'manual', target)];
  return channelPermissionFindings(ctx, emit, `${prefix}_permissions`, id, at, rule);
}

/**
 * `name` (manual) when the bot lacks some of `rule.perms` in the channel, listing them.
 * Only for a cached channel of the rule's kinds; anything else is `channelFindings`' job.
 */
export function channelPermissionFindings<N extends string>(
  ctx: CheckContext,
  emit: Emit<N>,
  name: NoInfer<N>,
  id: string,
  at: FindingTarget,
  rule: ChannelRule,
): HealthFinding[] {
  const ref = resolveChannel(ctx.guild, id, rule);
  if (ref.status !== 'ok' || !ctx.me || !channelIsKind(ref.value, ...rule.kinds)) return [];
  const missing = missingPermissions(ctx.me, rule.perms, ref.value);
  if (missing.length === 0) return [];
  // "ViewChannel" -> "View Channel", as Discord's settings name them.
  const permissions = missing.map(perm => perm.replace(/(?<=[a-z])(?=[A-Z])/g, ' ')).join(', ');
  const params = { ...at.params, channelId: id, permissions };
  return [emit(name, rule.severity, 'manual', { ...at, refId: id, params })];
}

/**
 * A role the bot grants: `<prefix>_missing`, `_unassignable` (@everyone or managed
 * by an integration) or `_above_bot`, by the reaction-role menu rules
 * (`validateRoleForMenu`). Grants fail silently, so both are degraded.
 */
export function assignableRoleFindings<P extends string>(
  ctx: CheckContext,
  emit: Emit<NoInfer<RoleNames<P>>>,
  prefix: P,
  id: string,
  at: FindingTarget,
  missing: { severity: HealthSeverity; repair: RepairClass },
): HealthFinding[] {
  const target: FindingTarget = { ...at, refId: id, params: { ...at.params, roleId: id } };
  const ref = resolveRole(ctx.guild, id);
  if (ref.status === 'missing') return [emit(`${prefix}_missing`, missing.severity, missing.repair, target)];
  if (ref.status !== 'ok' || !ctx.me) return [];
  const role = ref.value;
  if (validateRoleForMenu(role, ctx.guild, ctx.me.roles.highest.position).valid) return [];
  const fixable = role.id !== ctx.guildId && !role.managed;
  return [emit(fixable ? `${prefix}_above_bot` : `${prefix}_unassignable`, 'degraded', 'manual', target)];
}

/** One cosmetic finding per id in a stored list whose channel or role was deleted (auto: prune it). */
export function prunableRefs<N extends string>(
  ctx: CheckContext,
  emit: Emit<N>,
  name: N,
  kind: 'channel' | 'role',
  ids: Iterable<string> | null | undefined,
  at: FindingTarget,
): HealthFinding[] {
  const resolve = kind === 'channel' ? resolveChannel : resolveRole;
  return [...(ids ?? [])]
    .filter(id => resolve(ctx.guild, id).status === 'missing')
    .map(id => emit(name, 'cosmetic', 'auto', { ...at, refId: id, params: { ...at.params, [`${kind}Id`]: id } }));
}
