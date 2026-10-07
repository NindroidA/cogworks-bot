/**
 * Repairs for findings about a deleted channel, role, message or thread. Each
 * one runs the delete event's patch from `REF_PATCHES` on the flagged row, so
 * a repair fixes a reference exactly as the event would have, limited to the
 * columns of the finding.
 */
import { lang } from '../../../lang';
import {
  FINAL_STATUSES,
  REF_PATCHES,
  type RefEntityName,
  type RefKind,
  type RefPatch,
  type RefPatchFn,
} from '../../cleanup/refPatches';
import type { HealthFinding } from '../types';
import type { RepairEntityName, RepairProof } from './types';

type Row = Record<string, unknown>;

/** How the planner fixes one finding code on its row: these delete-event repairs, and the field repairs. */
export interface RowRepair {
  entity: RepairEntityName;
  /** What the flagged row becomes, or null when there is nothing to change. Never mutates the row. */
  patch(row: Row, finding: HealthFinding): RefPatch | null;
  /** A set may change only these columns. For a delete, the values that justify it (its guard). */
  fields: readonly string[];
  /** Columns a set doesn't change but depends on: they join its guard. */
  guards?: readonly string[];
  /** How the applier re-proves the object is gone. None when the database alone shows the problem. */
  proof?: RepairProof['kind'];
  /** Ask first even when the check rates the finding auto. */
  confirm?: true;
  /** True for a row the patch leaves alone on purpose, though it still holds the reference. */
  keeps?: (row: Row) => boolean;
}

type PatchedBy<K extends RefKind> = keyof (typeof REF_PATCHES)[K] & RefEntityName;

function ref<K extends RefKind>(
  kind: K,
  entity: PatchedBy<K>,
  fields: readonly string[],
  extra: Partial<Pick<RowRepair, 'proof' | 'confirm' | 'keeps'>> = {},
): RowRepair {
  const patchFn = (REF_PATCHES[kind] as Partial<Record<RefEntityName, RefPatchFn>>)[entity] as RefPatchFn;
  // The planner only plans a repair with a proof for a finding that names the object (refId).
  return { entity, patch: (row, f) => (f.refId ? patchFn(row, f.refId) : null), fields, proof: kind, ...extra };
}

/** An application already accepted or rejected keeps that outcome: the close patch skips it. */
const keepsOutcome = (row: Row) => FINAL_STATUSES.has(String(row.status));

// The posted panel goes with its channel, so the message id is cleared too.
const panel = (system: string, config: PatchedBy<'channel'>, archive: PatchedBy<'channel'>) => ({
  [`${system}.panel.channel_missing`]: ref('channel', config, ['channelId', 'messageId']),
  [`${system}.panel.category_missing`]: ref('channel', config, ['categoryId']),
  [`${system}.archive.channel_missing`]: ref('channel', archive, ['channelId', 'messageId']),
});

/**
 * Repair per finding code. Memory deletes always ask first: saved memory text
 * has no other copy. A code without an entry is reported as unsupported.
 */
export const REF_REPAIRS: Readonly<Record<string, RowRepair>> = {
  'core.global_staff_role.missing': ref('role', 'BotConfig', ['globalStaffRole', 'enableGlobalStaffRole']),
  'core.staff_role.missing': ref('role', 'StaffRole', ['role']),
  ...panel('ticket', 'TicketConfig', 'ArchivedTicketConfig'),
  ...panel('application', 'ApplicationConfig', 'ArchivedApplicationConfig'),
  // Closes with a `channel-deleted` note; already-final statuses get no patch.
  'ticket.open.channel_missing': ref('channel', 'Ticket', ['status', 'statusHistory'], { keeps: keepsOutcome }),
  'application.open.channel_missing': ref('channel', 'Application', ['status', 'statusHistory'], {
    keeps: keepsOutcome,
  }),
  // The check proves this one with a REST lookup (the id may be a thread), so the applier does too.
  'announcement.config.channel_missing': ref('channel', 'AnnouncementConfig', ['defaultChannelId'], {
    proof: 'thread',
  }),
  'announcement.config.role_missing': ref('role', 'AnnouncementConfig', ['defaultRoleId']),
  'memory.forum.missing': ref('channel', 'MemoryConfig', ['forumChannelId'], { confirm: true }),
  // The welcome post is a forum thread whose starter message shares its id.
  'memory.forum.welcome_missing': ref('message', 'MemoryConfig', ['messageId'], { proof: 'thread' }),
  'memory.item.thread_missing': ref('thread', 'MemoryItem', ['threadId'], { confirm: true }),
  'reactionRole.option.role_missing': ref('role', 'ReactionRoleOption', ['roleId']),
  'reactionRole.menu.channel_missing': ref('channel', 'ReactionRoleMenu', ['channelId']),
  'reactionRole.menu.message_missing': ref('message', 'ReactionRoleMenu', ['messageId']),
  'xp.config.level_up_channel_missing': ref('channel', 'XPConfig', ['levelUpChannelId']),
  'xp.config.ignored_channel_missing': ref('channel', 'XPConfig', ['ignoredChannels']),
  'xp.config.ignored_role_missing': ref('role', 'XPConfig', ['ignoredRoles']),
  'xp.config.multiplier_channel_missing': ref('channel', 'XPConfig', ['multiplierChannels']),
  'xp.role_reward.role_missing': ref('role', 'XPRoleReward', ['roleId']),
  'starboard.config.channel_missing': ref('channel', 'StarboardConfig', ['enabled', 'channelId']),
  'starboard.config.ignored_channel_missing': ref('channel', 'StarboardConfig', ['ignoredChannels']),
  'onboarding.config.completion_role_missing': ref('role', 'OnboardingConfig', ['completionRoleId']),
  'onboarding.config.step_role_missing': ref('role', 'OnboardingConfig', ['steps']),
  'rules.config.channel_missing': ref('channel', 'RulesConfig', ['channelId']),
  'rules.config.message_missing': ref('message', 'RulesConfig', ['messageId']),
};

/** The repair's label (`health.repair.actions`), for the preview; the code itself when it has none. */
export function repairLabel(code: string): string {
  return (lang.health.repair.actions as Record<string, string>)[code] ?? code;
}
