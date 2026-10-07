/**
 * Repair planner: turns a health report into the writes that would fix it.
 * Dry run only. It reads the rows the check loaded (`ctx.rows`), never writes,
 * and never changes `ctx`: every value it returns is a copy.
 */
import { isDeepStrictEqual } from 'node:util';
import type { RefCascade } from '../../cleanup/refPatches';
import type { CheckContext, HealthEntityName } from '../context';
import type { HealthFinding, HealthReport } from '../types';
import { FIELD_REPAIRS, type FieldRepair, type InsertRepair } from './fieldRepairs';
import { findingKey } from './keys';
import { REF_REPAIRS, type RowRepair, repairLabel } from './refRepairs';
import type {
  PlanOptions,
  RepairCommand,
  RepairEntityName,
  RepairFix,
  RepairPlan,
  RepairProof,
  RepairStep,
  UnsupportedReason,
} from './types';

type Row = Record<string, unknown>;

/** A fix on a loaded row plus what merging it into a step needs. */
interface Planned {
  fix: RepairFix;
  def: RowRepair;
  row: Row;
  finding: HealthFinding;
  proof?: RepairProof;
  cascade?: readonly RefCascade[];
}

/** An insert is a step of its own; a command's step is shared, so only its name is kept. */
type Standalone = { fix: RepairFix; step: RepairStep } | { fix: RepairFix; command: RepairCommand };

/** What every fix carries, whatever it does. */
type FixBase = Pick<RepairFix, 'key' | 'code' | 'label' | 'system' | 'repair'>;

const copy = <T>(value: T): T => structuredClone(value);

/** BotConfig is keyed by its guild; every other row by its id. */
const primaryKey = (entity: RepairEntityName) => (entity === 'BotConfig' ? 'guildId' : 'id');

/** An entity's loaded rows, or null when they failed to load or this run didn't load them. Options load with their menu. */
function loadedRows(ctx: CheckContext, entity: RepairEntityName): Row[] | null {
  if (entity === 'ReactionRoleOption')
    return loadedRows(ctx, 'ReactionRoleMenu')?.flatMap(menu => (menu.options as Row[] | undefined) ?? []) ?? null;
  return (ctx.rows[entity as HealthEntityName] as Row[] | null | undefined) ?? null;
}

/** Copies of `row`'s values for `fields`. */
function pick(row: Row, fields: Iterable<string>): Row {
  return Object.fromEntries([...fields].map(field => [field, copy(row[field])]));
}

/** The values in `set` for `fields` that differ from `row`. */
function changed(row: Row, set: Row, fields: readonly string[]): Row {
  return Object.fromEntries(
    fields.filter(field => field in set && !isDeepStrictEqual(set[field], row[field])).map(f => [f, set[f]]),
  );
}

function whereOf(guildId: string, entity: RepairEntityName, row: Row): RepairStep['where'] {
  if (entity === 'BotConfig') return { guildId };
  const where = { guildId, id: row.id as number };
  return entity === 'ReactionRoleOption' ? { ...where, menuId: row.menuId as number } : where;
}

/** One finding as a fix against its loaded row, or why it can't be one. */
function planRow(f: HealthFinding, def: RowRepair, ctx: CheckContext, base: FixBase): Planned | UnsupportedReason {
  // A repair the applier must re-prove needs the object's id.
  if (f.rowId === undefined || (def.proof && !f.refId)) return 'no_action';
  const rows = loadedRows(ctx, def.entity);
  if (!rows) return 'rows_unavailable';
  const row = rows.find(r => String(r[primaryKey(def.entity)]) === String(f.rowId));
  if (!row) return 'row_gone';
  const patch = def.patch(row, f);
  if (!patch) return def.keeps?.(row) ? 'kept_outcome' : 'no_change';
  const fix = { ...base, entity: def.entity, rowId: f.rowId };
  const channelId = def.proof === 'message' ? { channelId: String(row.channelId) } : {};
  const proof = def.proof && f.refId ? { proof: { kind: def.proof, id: f.refId, ...channelId } } : {};
  const planned = { def, row, finding: f, ...proof };

  if ('remove' in patch) {
    const cascade: Partial<Record<RepairEntityName, number>> = {};
    for (const child of patch.cascade ?? []) {
      // The preview must say what goes with the row ("deletes N saved memories"), so no count, no fix.
      const children = loadedRows(ctx, child.entity);
      if (!children) return 'rows_unavailable';
      cascade[child.entity] = children.filter(c => c[child.column] === row.id).length;
    }
    const counts = patch.cascade ? { cascade } : {};
    return { ...planned, fix: { ...fix, op: 'delete', changes: [], ...counts }, cascade: copy(patch.cascade) };
  }
  const set = changed(row, patch.set as Row, def.fields);
  const changes = Object.entries(set).map(([field, after]) => ({
    field,
    before: copy(row[field]),
    after: copy(after),
  }));
  return changes.length > 0 ? { ...planned, fix: { ...fix, op: 'set', changes } } : 'no_change';
}

/** An insert of the finding's row, scoped to the guild, as its own step. */
function planInsert(f: HealthFinding, def: InsertRepair, ctx: CheckContext, base: FixBase): Standalone | 'no_action' {
  const values = def.insert(f);
  if (!values) return 'no_action';
  const where = { guildId: ctx.guildId };
  const step: RepairStep = {
    entity: def.entity,
    where,
    op: 'insert',
    values: { ...values, ...where },
    guard: {},
    proofs: [],
    keys: [base.key],
  };
  return { fix: { ...base, entity: def.entity, op: 'insert', changes: [] }, step };
}

/** The fix for one finding: a command, an insert, or a write to the flagged row. */
function planFix(f: HealthFinding, def: FieldRepair, ctx: CheckContext, base: FixBase) {
  if ('command' in def) {
    const fix: RepairFix = { ...base, entity: 'ApplicationCommand', op: 'command', changes: [] };
    return { fix, command: def.command };
  }
  return 'insert' in def ? planInsert(f, def, ctx, base) : planRow(f, def, ctx, base);
}

function uniqueProofs(group: readonly Planned[]): RepairProof[] {
  const proofs = group.flatMap(({ proof }) => (proof ? [proof] : []));
  return [...new Map(proofs.map(proof => [`${proof.kind}:${proof.id}`, proof])).values()];
}

/** The fixes on one row as one write. A delete absorbs the row's sets. */
function rowStep(group: readonly Planned[], guildId: string): RepairStep {
  const { def, row } = group[0];
  const base = { entity: def.entity, where: whereOf(guildId, def.entity, row), keys: group.map(p => p.fix.key) };
  const deletes = group.filter(p => p.fix.op === 'delete');
  if (deletes.length > 0) {
    const cascade = deletes.find(p => p.cascade)?.cascade;
    const fields = deletes.flatMap(p => p.def.fields);
    const guard = pick(row, fields);
    return { ...base, op: 'delete', guard, ...(cascade ? { cascade } : {}), proofs: uniqueProofs(deletes) };
  }
  // Each patch runs on the result of the ones before it, so two fixes to one list both land.
  const working: Row = { ...row };
  const set: Row = {};
  for (const p of group) {
    const patch = p.def.patch(working, p.finding);
    const next = patch && 'set' in patch ? changed(working, patch.set as Row, p.def.fields) : {};
    Object.assign(working, next);
    Object.assign(set, next);
  }
  const guarded = new Set([...Object.keys(set), ...group.flatMap(p => p.def.guards ?? [])]);
  return { ...base, op: 'set', set: copy(set), guard: pick(row, guarded), proofs: uniqueProofs(group) };
}

/** One step per row, then a parent's delete absorbs its children's steps: their rows go with its cascade. */
function mergeSteps(planned: readonly Planned[], guildId: string): RepairStep[] {
  const byRow = new Map<string, Planned[]>();
  for (const p of planned) {
    const id = `${p.def.entity}:${p.fix.rowId}`;
    byRow.set(id, [...(byRow.get(id) ?? []), p]);
  }
  const steps = [...byRow.values()].map(group => ({
    step: rowStep(group, guildId),
    row: group[0].row,
    absorbed: false,
  }));
  for (const parent of steps) {
    for (const { entity, column } of parent.step.cascade ?? []) {
      for (const child of steps) {
        if (child.absorbed || child.step.entity !== entity || child.row[column] !== parent.row.id) continue;
        parent.step.keys.push(...child.step.keys);
        child.absorbed = true;
      }
    }
  }
  return steps.filter(s => !s.absorbed).map(s => s.step);
}

/**
 * The fixes and writes for a report's auto and confirm findings, against the
 * rows the same run loaded (`runHealthCheckWithContext`). Manual findings are
 * skipped; ones without a repair, or whose row can't be read, are listed in
 * `unsupported`. `keys` and `classes` narrow it to a selection. Row writes come
 * first, then inserts, then one step per command however many fixes ask for it.
 */
export function planRepairs(report: HealthReport, ctx: CheckContext, opts: PlanOptions = {}): RepairPlan {
  const keys = opts.keys ? new Set(opts.keys) : null;
  const classes = opts.classes ?? ['auto', 'confirm'];
  const plan: RepairPlan = { fixes: [], steps: [], unsupported: [] };
  const planned: Planned[] = [];
  const inserts: RepairStep[] = [];
  const commands = new Map<RepairCommand, string[]>();
  const seen = new Set<string>();
  for (const f of Object.values(report.systems).flatMap(system => system?.findings ?? [])) {
    const key = findingKey(f);
    // A list holding one id twice yields the same finding twice: one fix covers both.
    if (f.repair === 'manual' || seen.has(key)) continue;
    seen.add(key);
    const def = REF_REPAIRS[f.code] ?? FIELD_REPAIRS[f.code];
    const repair = f.repair === 'confirm' || def?.confirm ? 'confirm' : 'auto';
    if ((keys && !keys.has(key)) || !classes.includes(repair)) continue;
    const base = { key, code: f.code, label: repairLabel(f.code), system: f.system, repair } as const;
    const result = def ? planFix(f, def, ctx, base) : 'no_action';
    if (typeof result === 'string') {
      plan.unsupported.push({ key, code: f.code, reason: result });
      continue;
    }
    plan.fixes.push(result.fix);
    if ('def' in result) planned.push(result);
    else if ('step' in result) inserts.push(result.step);
    else commands.set(result.command, [...(commands.get(result.command) ?? []), key]);
  }
  const where = { guildId: ctx.guildId };
  const commandSteps = [...commands].map(
    ([command, stepKeys]): RepairStep => ({
      entity: 'ApplicationCommand',
      where,
      op: 'command',
      command,
      guard: {},
      proofs: [],
      keys: stepKeys,
    }),
  );
  plan.steps = [...mergeSteps(planned, ctx.guildId), ...inserts, ...commandSteps];
  return plan;
}
