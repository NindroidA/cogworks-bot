/**
 * Repair planner: turns a health report into the writes that would fix it.
 * Dry run only. It reads the rows the check loaded (`ctx.rows`), never writes,
 * and never changes `ctx`: every value it returns is a copy.
 */
import { isDeepStrictEqual } from 'node:util';
import type { RefCascade, RefEntityName } from '../../cleanup/refPatches';
import type { CheckContext, HealthEntityName } from '../context';
import type { HealthFinding, HealthReport } from '../types';
import { findingKey } from './keys';
import { REF_REPAIRS, type RefRepair } from './refRepairs';
import type { PlanOptions, RepairFix, RepairPlan, RepairProof, RepairStep, UnsupportedReason } from './types';

type Row = Record<string, unknown>;

/** A fix plus what merging it into a step needs. */
interface Planned {
  fix: RepairFix;
  def: RefRepair;
  row: Row;
  refId: string;
  proof: RepairProof;
  cascade?: readonly RefCascade[];
}

const copy = <T>(value: T): T => structuredClone(value);

/** BotConfig is keyed by its guild; every other row by its id. */
const primaryKey = (entity: RefEntityName) => (entity === 'BotConfig' ? 'guildId' : 'id');

/** An entity's loaded rows, or null when they failed to load or this run didn't load them. Options load with their menu. */
function loadedRows(ctx: CheckContext, entity: RefEntityName): Row[] | null {
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

function whereOf(guildId: string, entity: RefEntityName, row: Row): RepairStep['where'] {
  if (entity === 'BotConfig') return { guildId };
  const where = { guildId, id: row.id as number };
  return entity === 'ReactionRoleOption' ? { ...where, menuId: row.menuId as number } : where;
}

/** One finding as a fix against its loaded row, or why it can't be one. */
function planFinding(
  f: HealthFinding & { refId: string; rowId: string | number },
  def: RefRepair,
  ctx: CheckContext,
  base: Pick<RepairFix, 'key' | 'repair'>,
): Planned | UnsupportedReason {
  const rows = loadedRows(ctx, def.entity);
  if (!rows) return 'rows_unavailable';
  const row = rows.find(r => String(r[primaryKey(def.entity)]) === String(f.rowId));
  if (!row) return 'row_gone';
  const patch = def.patch(row, f.refId);
  if (!patch) return 'no_change';
  const fix = { ...base, code: f.code, system: f.system, entity: def.entity, rowId: f.rowId };
  const channelId = def.proof === 'message' ? { channelId: String(row.channelId) } : {};
  const planned = { def, row, refId: f.refId, proof: { kind: def.proof, id: f.refId, ...channelId } };

  if ('remove' in patch) {
    const cascade: Partial<Record<RefEntityName, number>> = {};
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

function uniqueProofs(group: readonly Planned[]): RepairProof[] {
  return [...new Map(group.map(({ proof }) => [`${proof.kind}:${proof.id}`, proof])).values()];
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
    const patch = p.def.patch(working, p.refId);
    const next = patch && 'set' in patch ? changed(working, patch.set as Row, p.def.fields) : {};
    Object.assign(working, next);
    Object.assign(set, next);
  }
  return { ...base, op: 'set', set: copy(set), guard: pick(row, Object.keys(set)), proofs: uniqueProofs(group) };
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
 * `unsupported`. `keys` and `classes` narrow it to a selection.
 */
export function planRepairs(report: HealthReport, ctx: CheckContext, opts: PlanOptions = {}): RepairPlan {
  const keys = opts.keys ? new Set(opts.keys) : null;
  const classes = opts.classes ?? ['auto', 'confirm'];
  const plan: RepairPlan = { fixes: [], steps: [], unsupported: [] };
  const planned: Planned[] = [];
  for (const f of Object.values(report.systems).flatMap(system => system?.findings ?? [])) {
    if (f.repair === 'manual') continue;
    const key = findingKey(f);
    const def = REF_REPAIRS[f.code];
    const repair = f.repair === 'confirm' || def?.confirm ? 'confirm' : 'auto';
    if ((keys && !keys.has(key)) || !classes.includes(repair)) continue;
    const { refId, rowId } = f;
    const result =
      def && refId && rowId !== undefined
        ? planFinding({ ...f, refId, rowId }, def, ctx, { key, repair })
        : 'no_action';
    if (typeof result === 'string') plan.unsupported.push({ key, code: f.code, reason: result });
    else {
      planned.push(result);
      plan.fixes.push(result.fix);
    }
  }
  plan.steps = mergeSteps(planned, ctx.guildId);
  return plan;
}
