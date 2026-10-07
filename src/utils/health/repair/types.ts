/**
 * Repair plan types. A plan is plain JSON-serializable data: what the
 * `/bot-health` repair preview lists, and the writes an applier makes. Planning
 * itself never writes.
 */
import type { RefCascade } from '../../cleanup/refPatches';
import type { HealthEntityName } from '../context';
import type { HealthSystem } from '../types';

/** The tables a repair writes: every entity the checks load, plus reaction-role options (loaded with their menu). */
export type RepairEntityName = HealthEntityName | 'ReactionRoleOption';

/**
 * What the applier re-checks right before a write: the object must still be
 * gone. `channel` and `role` come from the guild cache. `thread` is a channel
 * id that may be an uncached (archived) thread, and `message` lives in
 * `channelId`: both need one REST lookup.
 */
export interface RepairProof {
  kind: 'channel' | 'role' | 'thread' | 'message';
  id: string;
  channelId?: string;
}

/** Sets, deletes and inserts write one row; a command runs once for the guild. */
export type RepairOp = 'set' | 'delete' | 'insert' | 'command';

/** A command step's action: register the guild's slash commands again. */
export type RepairCommand = 'registerGuildCommands';

export interface RepairChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** One finding the plan fixes, as the preview shows it. */
export interface RepairFix {
  /** `findingKey` of the finding. */
  key: string;
  code: string;
  /** What the repair does, in English (`health.repair.actions`). */
  label: string;
  system: HealthSystem;
  /** The finding's class, or `confirm` where repair asks first even though the check rates it auto. */
  repair: 'auto' | 'confirm';
  entity: RepairEntityName | 'ApplicationCommand';
  /** The row a set or delete changes; an insert or command has none. */
  rowId?: string | number;
  op: RepairOp;
  /** A set: each column it changes, against the row as loaded (so it doesn't depend on which other fixes run); else empty. */
  changes: RepairChange[];
  /** A delete: the child rows deleted with the row, per entity (`MemoryItem` is the "deletes N saved memories" count). */
  cascade?: Partial<Record<RepairEntityName, number>>;
}

/** One write: every selected fix on one row merged, one inserted row, or one command for the guild. */
export interface RepairStep {
  entity: RepairEntityName | 'ApplicationCommand';
  /**
   * Always scoped by `guildId` (an insert or command: only that).
   * `ReactionRoleOption` has no guildId column: its where adds `menuId`, and
   * the store checks the menu belongs to the guild.
   */
  where: Record<string, string | number>;
  op: RepairOp;
  /** A set: the new value of every column it changes. */
  set?: Record<string, unknown>;
  /** An insert: the new row. Insert-ignore: a row already on its unique key leaves it alone (`exists`). */
  values?: Record<string, unknown>;
  /** A command: what the applier runs. */
  command?: RepairCommand;
  /**
   * The loaded value of every column the step changes, plus any column the
   * fix depends on (for a delete: the values that justify it). The applier
   * writes only while these still match. Empty for an insert or command.
   */
  guard: Record<string, unknown>;
  /** A delete: child rows (`column` = this row's id) removed first. */
  cascade?: readonly RefCascade[];
  /** Every proof must still read missing, or the step is skipped. */
  proofs: RepairProof[];
  /** Keys of the fixes this step carries, including ones a delete absorbed. */
  keys: string[];
}

export type UnsupportedReason =
  /** No repair is defined for the code (yet). */
  | 'no_action'
  /** The rows the repair needs failed to load (or weren't loaded by this run). */
  | 'rows_unavailable'
  /** The row the finding names isn't among the loaded rows. */
  | 'row_gone'
  /** The row no longer holds the reference, so there is nothing to change. */
  | 'no_change'
  /** The row is in a final state the repair keeps (an accepted or rejected application whose channel is gone). */
  | 'kept_outcome';

export interface UnsupportedFix {
  key: string;
  code: string;
  reason: UnsupportedReason;
}

export interface RepairPlan {
  fixes: RepairFix[];
  steps: RepairStep[];
  /** Auto and confirm findings the plan can't fix. Manual findings are left out. */
  unsupported: UnsupportedFix[];
}

export interface PlanOptions {
  /** Only these finding keys (the preview's selection). */
  keys?: Iterable<string>;
  /** Only fixes of these classes, after repair's own overrides. Default: both. */
  classes?: readonly RepairFix['repair'][];
}
