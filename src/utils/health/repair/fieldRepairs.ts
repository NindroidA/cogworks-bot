/**
 * Repairs for findings about a row's own values rather than a deleted Discord
 * object: a legacy or unsupported value rewritten, a duplicate or orphaned row
 * deleted, a bad list entry dropped, a missing built-in announcement template
 * inserted, and the guild's slash commands registered again.
 *
 * One entry per finding code. Row repairs work like the delete-event repairs
 * in refRepairs.ts: the planner runs the patch on the loaded row, and the
 * write only lands while the row still holds what the check saw. Most need no
 * proof, because the database alone shows the problem.
 */
import { DEFAULT_ANNOUNCEMENT_TEMPLATES } from '../../announcement/defaultTemplates';
import type { RefPatch } from '../../cleanup/refPatches';
import { MAX } from '../../constants';
import { appendStatusHistory } from '../../workflow/workflowHelpers';
import { parseRoleRef } from '../refs';
import type { HealthFinding } from '../types';
import type { RowRepair } from './refRepairs';
import type { RepairCommand, RepairEntityName } from './types';

type Row = Record<string, unknown>;

/** Adds a row. The planner adds the guild's id; the store skips a row already on its unique key (`exists`). */
export interface InsertRepair {
  entity: RepairEntityName;
  /** The row to add for the finding, or null when there is none. */
  insert(finding: HealthFinding): Row | null;
  confirm?: true;
}

/** Runs once for the guild, however many findings ask for it. */
export interface CommandRepair {
  command: RepairCommand;
  confirm?: true;
}

export type FieldRepair = RowRepair | InsertRepair | CommandRepair;

/** One column set to a fixed value. */
const setTo = (entity: RepairEntityName, field: string, value: unknown, extra: Partial<RowRepair> = {}): RowRepair => ({
  entity,
  fields: [field],
  patch: () => ({ set: { [field]: value } }),
  ...extra,
});

/** Delete the row while `fields` still hold the values that justify it. */
const deleteRow = (entity: RepairEntityName, fields: string[], extra: Partial<RowRepair> = {}): RowRepair => ({
  entity,
  fields,
  patch: () => ({ remove: true }),
  ...extra,
});

/** A role saved as the legacy `<@&id>` mention becomes the raw id every reader also accepts. */
const rawRoleId = (entity: RepairEntityName, field: string): RowRepair => ({
  entity,
  fields: [field],
  patch: row => {
    const ref = parseRoleRef(row[field] as string | null);
    return ref?.legacy ? { set: { [field]: ref.id } } : null;
  },
});

/** Close with a `creation-failed` note, as the delete event closes a ticket whose channel went. */
function closeFailedTicket(row: Row): RefPatch | null {
  if (row.status !== 'created' || row.channelId) return null;
  // appendStatusHistory writes to the object it's given, so give it a copy.
  const next = { statusHistory: Array.isArray(row.statusHistory) ? [...row.statusHistory] : null };
  appendStatusHistory(next, 'closed', 'system', MAX.TICKET_STATUS_HISTORY, 'creation-failed');
  return { set: { status: 'closed', statusHistory: next.statusHistory } };
}

/** Drop the finding's channel from the multiplier map; an empty map is stored as null, as channelDelete does. */
function dropMultiplier(row: Row, f: HealthFinding): RefPatch | null {
  const map = row.multiplierChannels as Record<string, number> | null;
  if (!f.refId || !map || map[f.refId] === undefined) return null;
  const { [f.refId]: _dropped, ...rest } = map;
  return { set: { multiplierChannels: Object.keys(rest).length > 0 ? rest : null } };
}

/** Unselect the finding's unknown system (every copy of it). */
function dropSystem(row: Row, f: HealthFinding): RefPatch | null {
  const selected = row.selectedSystems;
  if (!Array.isArray(selected)) return null;
  return { set: { selectedSystems: selected.filter(id => String(id) !== String(f.params.systemId)) } };
}

const registerCommands: CommandRepair = { command: 'registerGuildCommands' };

/**
 * Repair per finding code. A code with no entry here or in `REF_REPAIRS` is
 * reported as unsupported. Saved memory text has no other copy, so deleting
 * an orphaned memory asks first.
 */
export const FIELD_REPAIRS: Readonly<Record<string, FieldRepair>> = {
  // Only while still no role is selected: picking one meanwhile keeps the flag on.
  'core.global_staff_role.enabled_without_role': setTo('BotConfig', 'enableGlobalStaffRole', false, {
    guards: ['globalStaffRole'],
  }),
  'core.global_staff_role.format_legacy': rawRoleId('BotConfig', 'globalStaffRole'),
  'core.locale.unsupported': setTo('BotConfig', 'locale', 'en'),
  // The check rates it auto only when both rows carry the same alias; the guard keeps the alias it saw.
  'core.staff_role.duplicate': deleteRow('StaffRole', ['type', 'role', 'alias']),
  'core.staff_role.invalid': deleteRow('StaffRole', ['role']),
  'core.staff_role.format_legacy': rawRoleId('StaffRole', 'role'),
  'core.guild_permission.unknown_feature': deleteRow('GuildPermission', ['feature']),
  'core.guild_permission.unknown_level': deleteRow('GuildPermission', ['level']),
  'core.guild_permission.missing_role': deleteRow('GuildPermission', ['roleId'], { proof: 'role' }),
  'core.setup_state.unknown_system': { entity: 'SetupState', fields: ['selectedSystems'], patch: dropSystem },
  // Missing, changed and leftover commands are all fixed by one registration of the guild's set.
  'core.commands.missing': registerCommands,
  'core.commands.outdated': registerCommands,
  'core.commands.unexpected': registerCommands,
  'ticket.type.multiple_defaults': setTo('CustomTicketType', 'isDefault', false),
  'ticket.type.color_invalid': setTo('CustomTicketType', 'embedColor', '#0099ff'),
  'ticket.type.emoji_invalid': setTo('CustomTicketType', 'emoji', null),
  'ticket.restriction.unknown_type': deleteRow('UserTicketRestriction', ['typeId']),
  // A channel created meanwhile means it didn't fail after all.
  'ticket.open.creation_failed': {
    entity: 'Ticket',
    fields: ['status', 'statusHistory'],
    guards: ['channelId'],
    patch: closeFailedTicket,
  },
  'application.position.emoji_invalid': setTo('Position', 'emoji', null),
  'memory.tag.orphan': deleteRow('MemoryTag', ['memoryConfigId']),
  'memory.item.orphan': deleteRow('MemoryItem', ['memoryConfigId'], { confirm: true }),
  'reactionRole.menu.mode': setTo('ReactionRoleMenu', 'mode', 'normal'),
  'announcement.template.default_missing': {
    entity: 'AnnouncementTemplate',
    insert: f => {
      const template = DEFAULT_ANNOUNCEMENT_TEMPLATES.find(t => t.name === f.params.name);
      return template ? { ...structuredClone(template) } : null;
    },
  },
  'xp.config.multiplier_invalid': { entity: 'XPConfig', fields: ['multiplierChannels'], patch: dropMultiplier },
  'xp.config.rate_inverted': {
    entity: 'XPConfig',
    fields: ['xpPerMessageMin', 'xpPerMessageMax'],
    patch: row => ({ set: { xpPerMessageMin: row.xpPerMessageMax, xpPerMessageMax: row.xpPerMessageMin } }),
  },
  'xp.role_reward.duplicate_level': deleteRow('XPRoleReward', ['level', 'roleId']),
  'starboard.config.threshold_invalid': setTo('StarboardConfig', 'threshold', 1),
};
