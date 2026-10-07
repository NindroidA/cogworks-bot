/**
 * The JSON the internal API returns for a health report, its repair plan and a
 * repair's results. Each finding gains its key (what a repair request selects
 * it by), its explanation with the params filled in, and whether the plan can
 * fix it. A plan's steps are what one write changes, as before and after.
 */
import { fmt, lang } from '../../../lang';
import type { HealthFinding, HealthReport, SystemReport } from '../types';
import type { RepairResult, StepOutcome } from './applier';
import { findingKey } from './keys';
import type { RepairCommand, RepairFix, RepairOp, RepairPlan, RepairStep, UnsupportedFix } from './types';

export interface SerializedFinding extends HealthFinding {
  key: string;
  /** The explanation, as Discord markdown: the finding's lang string with its params, or the code when it has none. */
  text: string;
  /** The plan has a fix for it. */
  fixable: boolean;
  /** What that fix does (`health.repair.actions`); null when there is none. */
  label: string | null;
}

export interface SerializedReport extends Omit<HealthReport, 'systems'> {
  systems: Record<string, Omit<SystemReport, 'findings'> & { findings: SerializedFinding[] }>;
}

/**
 * The plan as a preview lists it, without its writes. A change value longer
 * than 200 characters as JSON (a long list) arrives as a cut-off JSON string
 * ending in `…`: every fix on a row carries the whole list, so full copies
 * would grow with the square of the findings. A dry run's steps have the
 * full values.
 */
export interface SerializedPlan {
  fixes: RepairFix[];
  unsupported: UnsupportedFix[];
}

export interface SerializedStep {
  entity: string;
  /** The row a set or delete writes; null for an insert or command. */
  rowId: string | number | null;
  op: RepairOp;
  /** The fixes it carries. */
  keys: string[];
  /** A set: the columns it changes as loaded. A delete: the values that justify it. Else null. */
  before: Record<string, unknown> | null;
  /** A set: the new values. An insert: the new row. Else null. */
  after: Record<string, unknown> | null;
  /** A delete: the child tables whose rows go with it. */
  cascade?: string[];
  command?: RepairCommand;
}

export interface SerializedStepResult extends SerializedStep {
  outcome: StepOutcome;
}

const findingStrings = lang.health.findings as Record<string, string>;
const MAX_CHANGE_VALUE = 200;

/** A value whose JSON is longer than the cap, as its JSON cut off with `…` (as the applier's audit row does). */
function clip(value: unknown): unknown {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return text.length > MAX_CHANGE_VALUE ? `${text.slice(0, MAX_CHANGE_VALUE - 1)}…` : value;
}

export function serializeReport(report: HealthReport, plan: RepairPlan): SerializedReport {
  const fixes = new Map(plan.fixes.map(fix => [fix.key, fix]));
  const systems: SerializedReport['systems'] = {};
  for (const [system, r] of Object.entries(report.systems)) {
    if (!r) continue;
    const findings = r.findings.map(f => {
      const key = findingKey(f);
      const fix = fixes.get(key);
      const text = fmt(findingStrings[f.code] ?? f.code, f.params);
      return { ...f, key, text, fixable: Boolean(fix), label: fix?.label ?? null };
    });
    systems[system] = { status: r.status, findings };
  }
  return { ...report, systems };
}

export function serializePlan(plan: RepairPlan): SerializedPlan {
  const fixes = plan.fixes.map(fix => ({
    ...fix,
    changes: fix.changes.map(({ field, before, after }) => ({ field, before: clip(before), after: clip(after) })),
  }));
  return { fixes, unsupported: plan.unsupported };
}

export function serializeStep(step: RepairStep): SerializedStep {
  const row = step.op === 'set' || step.op === 'delete';
  const base = { entity: step.entity, rowId: row ? (step.where.id ?? step.where.guildId) : null, op: step.op };
  const keys = [...step.keys];
  switch (step.op) {
    case 'set': {
      const set = step.set ?? {};
      const before = Object.fromEntries(Object.keys(set).map(field => [field, step.guard[field]]));
      return { ...base, keys, before, after: set };
    }
    case 'delete': {
      const cascade = step.cascade?.map(child => child.entity);
      return { ...base, keys, before: step.guard, after: null, ...(cascade ? { cascade } : {}) };
    }
    case 'insert':
      return { ...base, keys, before: null, after: step.values ?? {} };
    case 'command':
      return { ...base, keys, before: null, after: null, ...(step.command ? { command: step.command } : {}) };
  }
}

/** Each step as it ran, with its outcome. A failed step's error stays in the bot's log. */
export function serializeResults(result: RepairResult): SerializedStepResult[] {
  return result.results.map(({ step, outcome }) => ({ ...serializeStep(step), outcome }));
}
