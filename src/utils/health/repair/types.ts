/**
 * Repair plan types. A plan is plain JSON-serializable data: what the
 * `/bot-health` repair preview lists, and the writes an applier makes. Planning
 * itself never writes.
 */
import type { RefCascade, RefEntityName } from '../../cleanup/refPatches';
import type { HealthSystem } from '../types';

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

export type RepairOp = 'set' | 'delete';

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
  system: HealthSystem;
  /** The finding's class, or `confirm` where repair asks first even though the check rates it auto. */
  repair: 'auto' | 'confirm';
  entity: RefEntityName;
  rowId: string | number;
  op: RepairOp;
  /** A set: each column it changes, against the row as loaded (so it doesn't depend on which other fixes run). */
  changes: RepairChange[];
  /** A delete: the child rows deleted with the row, per entity (`MemoryItem` is the "deletes N saved memories" count). */
  cascade?: Partial<Record<RefEntityName, number>>;
}

/** One write: every selected fix on one row, merged. */
export interface RepairStep {
  entity: RefEntityName;
  /**
   * Always scoped by `guildId`. `ReactionRoleOption` has no guildId column: its
   * where adds `menuId`, and the store checks the menu belongs to the guild.
   */
  where: Record<string, string | number>;
  op: RepairOp;
  /** A set: the new value of every column it changes. */
  set?: Record<string, unknown>;
  /**
   * The loaded value of every column the step changes (for a delete: the
   * reference that justifies it). The applier writes only while these still match.
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
  | 'no_change';

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
