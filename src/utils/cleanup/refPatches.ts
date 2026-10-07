/**
 * Pure per-entity patches for a deleted Discord object.
 *
 * Each entry takes one loaded row and the deleted object's id and says what
 * that row should become:
 *  - `null` when the row doesn't reference the id
 *  - `{ set }` with only the columns that change
 *  - `{ remove: true }` when the row is useless without the object; `cascade`
 *    names the child rows a plain DELETE has to remove first
 *
 * Patches never mutate the row they're given: lists, maps and status history
 * are copied. The delete-event cleaners in refCleaners.ts apply them to the
 * rows they load, and the /bot-health repair planner will apply the same
 * patches to the rows a health check flags, so both fix a reference the same way.
 *
 * Keep this module free of repositories, caches and the logger. Entity imports
 * are type-only, so loading it never touches the DataSource.
 */

import type { AnnouncementConfig } from '../../typeorm/entities/announcement/AnnouncementConfig';
import type { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import type { BotConfig } from '../../typeorm/entities/BotConfig';
import type { MemoryConfig } from '../../typeorm/entities/memory/MemoryConfig';
import type { MemoryItem } from '../../typeorm/entities/memory/MemoryItem';
import type { OnboardingConfig } from '../../typeorm/entities/onboarding/OnboardingConfig';
import type { ReactionRoleMenu } from '../../typeorm/entities/reactionRole/ReactionRoleMenu';
import type { ReactionRoleOption } from '../../typeorm/entities/reactionRole/ReactionRoleOption';
import type { RulesConfig } from '../../typeorm/entities/rules/RulesConfig';
import type { StaffRole } from '../../typeorm/entities/StaffRole';
import type { StarboardConfig } from '../../typeorm/entities/starboard/StarboardConfig';
import type { TicketStatusHistoryEntry } from '../../typeorm/entities/ticket/Ticket';
import type { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import type { XPConfig } from '../../typeorm/entities/xp/XPConfig';
import type { XPRoleReward } from '../../typeorm/entities/xp/XPRoleReward';
import { MAX } from '../constants';
import type { OnboardingStepDef } from '../onboarding/types';
import { appendStatusHistory } from '../workflow/workflowHelpers';

export type RefKind = 'channel' | 'role' | 'message' | 'thread';

/** Entities that have a patch here, or that a patch cascades to. */
export type RefEntityName =
  | 'AnnouncementConfig'
  | 'Application'
  | 'ApplicationConfig'
  | 'ArchivedApplicationConfig'
  | 'ArchivedTicketConfig'
  | 'BotConfig'
  | 'MemoryConfig'
  | 'MemoryItem'
  | 'MemoryTag'
  | 'OnboardingConfig'
  | 'ReactionRoleMenu'
  | 'ReactionRoleOption'
  | 'RulesConfig'
  | 'StaffRole'
  | 'StarboardConfig'
  | 'Ticket'
  | 'TicketConfig'
  | 'XPConfig'
  | 'XPRoleReward';

/** Child rows whose `column` holds the removed row's id. */
export interface RefCascade {
  entity: RefEntityName;
  column: string;
}

export interface SetPatch<T = object> {
  set: Partial<T>;
}

export interface RemovePatch {
  remove: true;
  cascade?: readonly RefCascade[];
}

export type RefPatch<T = object> = SetPatch<T> | RemovePatch;

/**
 * One entity's patch. Declared through a method so its parameter is checked
 * bivariantly: each entry takes its own entity's row type, and generic callers
 * can still pass any row.
 */
export type RefPatchFn = { patch(row: object, refId: string): RefPatch | null }['patch'];

export type RefPatchTable = Record<RefKind, Partial<Record<RefEntityName, RefPatchFn>>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOrNull<T>(set: Partial<T>): SetPatch<T> | null {
  return Object.keys(set).length > 0 ? { set } : null;
}

function removeRow(cascade?: readonly RefCascade[]): RemovePatch {
  return cascade ? { remove: true, cascade } : { remove: true };
}

function without(ids: readonly string[], id: string): string[] {
  return ids.filter(x => x !== id);
}

/** Raw role ID (v3 and later) or the legacy `<@&id>` mention older rows hold. */
function isRole(value: string | null, roleId: string): boolean {
  return value === roleId || value === `<@&${roleId}>`;
}

// TypeORM's remove() on a loaded menu takes its options through the eager
// relation; a plain DELETE has to remove them first.
const MENU_CASCADE: readonly RefCascade[] = Object.freeze([{ entity: 'ReactionRoleOption', column: 'menuId' }]);

// The forum's posts go with it, so its item and tag rows go too (as /memory-setup remove-channel does).
const MEMORY_CONFIG_CASCADE: readonly RefCascade[] = Object.freeze([
  { entity: 'MemoryItem', column: 'memoryConfigId' },
  { entity: 'MemoryTag', column: 'memoryConfigId' },
]);

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Panel and archive configs: the posted message goes with its channel. */
function clearPanelChannel(row: { channelId: string }, channelId: string) {
  return row.channelId === channelId ? { set: { channelId: '', messageId: '' } } : null;
}

/** Panel and archive configs keep their channel when only the message goes. */
function clearPanelMessage(row: { messageId: string }, messageId: string) {
  return row.messageId === messageId ? { set: { messageId: '' } } : null;
}

/** The columns a ticket or application close reads and writes. */
interface StatusRow {
  channelId: string | null;
  status: string;
  statusHistory: TicketStatusHistoryEntry[] | null;
}

/** Statuses that are already an outcome: closed, or an application decision that must not be lost. */
const FINAL_STATUSES: ReadonlySet<string> = new Set(['closed', 'accepted', 'rejected']);

/**
 * Close a ticket or application whose channel was deleted by hand, so it stops
 * counting as open. The close flows set 'closed' before deleting the channel,
 * so their rows get no patch.
 */
function closeInDeletedChannel(maxHistory: number) {
  return (row: Readonly<StatusRow>, channelId: string): SetPatch<StatusRow> | null => {
    if (row.channelId !== channelId || FINAL_STATUSES.has(row.status)) return null;
    // appendStatusHistory writes to the object it's given, so give it a copy
    const next = { statusHistory: row.statusHistory ? [...row.statusHistory] : null };
    appendStatusHistory(next, 'closed', 'system', maxHistory, 'channel-deleted');
    return { set: { status: 'closed', statusHistory: next.statusHistory } };
  };
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * Patches per reference kind and entity. Cleaners that stay inline in
 * refCleaners.ts (bait, events, analytics, the rules role and ticket routing
 * rules) have no entry.
 */
export const REF_PATCHES = {
  channel: {
    Ticket: closeInDeletedChannel(MAX.TICKET_STATUS_HISTORY),
    Application: closeInDeletedChannel(MAX.APPLICATION_STATUS_HISTORY),
    TicketConfig: (
      row: Pick<TicketConfig, 'channelId' | 'categoryId' | 'slaBreachChannelId'>,
      channelId: string,
    ): SetPatch<TicketConfig> | null => {
      const set: Partial<TicketConfig> = { ...clearPanelChannel(row, channelId)?.set };
      if (row.categoryId === channelId) set.categoryId = null;
      if (row.slaBreachChannelId === channelId) set.slaBreachChannelId = null;
      return setOrNull(set);
    },
    ArchivedTicketConfig: clearPanelChannel,
    ApplicationConfig: (
      row: Pick<ApplicationConfig, 'channelId' | 'categoryId'>,
      channelId: string,
    ): SetPatch<ApplicationConfig> | null => {
      const set: Partial<ApplicationConfig> = { ...clearPanelChannel(row, channelId)?.set };
      if (row.categoryId === channelId) set.categoryId = null;
      return setOrNull(set);
    },
    ArchivedApplicationConfig: clearPanelChannel,
    RulesConfig: (row: Pick<RulesConfig, 'channelId'>, channelId: string) =>
      row.channelId === channelId ? removeRow() : null,
    ReactionRoleMenu: (row: Pick<ReactionRoleMenu, 'channelId'>, channelId: string) =>
      row.channelId === channelId ? removeRow(MENU_CASCADE) : null,
    MemoryConfig: (row: Pick<MemoryConfig, 'forumChannelId'>, channelId: string) =>
      row.forumChannelId === channelId ? removeRow(MEMORY_CONFIG_CASCADE) : null,
    AnnouncementConfig: (row: Pick<AnnouncementConfig, 'defaultChannelId'>, channelId: string) =>
      row.defaultChannelId === channelId ? { set: { defaultChannelId: '' } } : null,
    StarboardConfig: (
      row: Pick<StarboardConfig, 'channelId' | 'ignoredChannels'>,
      channelId: string,
    ): SetPatch<StarboardConfig> | null => {
      const set: Partial<StarboardConfig> = {};
      if (row.channelId === channelId) {
        set.enabled = false;
        set.channelId = '';
      }
      if (row.ignoredChannels?.includes(channelId)) set.ignoredChannels = without(row.ignoredChannels, channelId);
      return setOrNull(set);
    },
    XPConfig: (
      row: Pick<XPConfig, 'levelUpChannelId' | 'ignoredChannels' | 'multiplierChannels'>,
      channelId: string,
    ): SetPatch<XPConfig> | null => {
      const set: Partial<XPConfig> = {};
      if (row.levelUpChannelId === channelId) set.levelUpChannelId = null;
      if (row.ignoredChannels?.includes(channelId)) set.ignoredChannels = without(row.ignoredChannels, channelId);
      if (row.multiplierChannels?.[channelId] !== undefined) {
        const { [channelId]: _, ...rest } = row.multiplierChannels;
        set.multiplierChannels = Object.keys(rest).length > 0 ? rest : null;
      }
      return setOrNull(set);
    },
  },

  role: {
    BotConfig: (row: Pick<BotConfig, 'globalStaffRole'>, roleId: string) =>
      isRole(row.globalStaffRole, roleId) ? { set: { globalStaffRole: null, enableGlobalStaffRole: false } } : null,
    ReactionRoleOption: (row: Pick<ReactionRoleOption, 'roleId'>, roleId: string) =>
      row.roleId === roleId ? removeRow() : null,
    AnnouncementConfig: (row: Pick<AnnouncementConfig, 'defaultRoleId'>, roleId: string) =>
      row.defaultRoleId === roleId ? { set: { defaultRoleId: null } } : null,
    StaffRole: (row: Pick<StaffRole, 'role'>, roleId: string) => (isRole(row.role, roleId) ? removeRow() : null),
    XPConfig: (row: Pick<XPConfig, 'ignoredRoles'>, roleId: string) =>
      row.ignoredRoles?.includes(roleId) ? { set: { ignoredRoles: without(row.ignoredRoles, roleId) } } : null,
    XPRoleReward: (row: Pick<XPRoleReward, 'roleId'>, roleId: string) => (row.roleId === roleId ? removeRow() : null),
    OnboardingConfig: (
      row: Pick<OnboardingConfig, 'completionRoleId' | 'steps'>,
      roleId: string,
    ): SetPatch<OnboardingConfig> | null => {
      const set: Partial<OnboardingConfig> = {};
      if (row.completionRoleId === roleId) set.completionRoleId = null;
      // Role-select steps would keep offering the deleted role to new members.
      const offersRole = (step: OnboardingStepDef) => step.options?.some(opt => opt.roleId === roleId) ?? false;
      if (row.steps?.some(offersRole)) {
        set.steps = row.steps.map(step =>
          offersRole(step) ? { ...step, options: step.options?.filter(opt => opt.roleId !== roleId) } : step,
        );
      }
      return setOrNull(set);
    },
  },

  message: {
    TicketConfig: clearPanelMessage,
    ArchivedTicketConfig: clearPanelMessage,
    ApplicationConfig: clearPanelMessage,
    ArchivedApplicationConfig: clearPanelMessage,
    RulesConfig: (row: Pick<RulesConfig, 'messageId'>, messageId: string) =>
      row.messageId === messageId ? removeRow() : null,
    ReactionRoleMenu: (row: Pick<ReactionRoleMenu, 'messageId'>, messageId: string) =>
      row.messageId === messageId ? removeRow(MENU_CASCADE) : null,
    MemoryConfig: (row: Pick<MemoryConfig, 'messageId'>, messageId: string) =>
      row.messageId === messageId ? { set: { messageId: null } } : null,
  },

  thread: {
    // Without its thread the memory item is orphaned, so it goes too.
    MemoryItem: (row: Pick<MemoryItem, 'threadId'>, threadId: string) =>
      row.threadId === threadId ? removeRow() : null,
  },
} satisfies RefPatchTable;
