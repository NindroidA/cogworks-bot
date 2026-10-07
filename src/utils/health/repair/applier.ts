/**
 * Repair applier: makes a plan's writes for one guild, under the guild's
 * repair lock.
 *
 * Each step first re-proves that the objects it relies on are still gone
 * (`verifyProof`), then writes through the store, which only writes while the
 * row still holds the values the plan saw. A step that fails is recorded and
 * the others still run. Afterwards the guild's caches are flushed once (only
 * if something changed) and one audit row is written to the guild.
 *
 * The default store, cache flushes and audit writer are loaded on first use,
 * so importing this module never loads the cache modules, command gating or
 * the audit helper; tests inject fakes.
 */
import type { Client, Guild } from 'discord.js';
import type { AuditSource } from '../../api/handlers/auditHelper';
import { enhancedLogger, LogCategory } from '../../monitoring/enhancedLogger';
import { createRestFetcher, type RestFetcher } from '../context';
import { RepairBusyError, tryLockGuildRepair } from './lock';
import { appRepairDb, createRepairStore, type RepairStore, type StoreOutcome } from './store';
import type { RepairPlan, RepairStep } from './types';
import { verifyProof } from './verify';

/**
 * A step's result. `skipped-not-missing`: a proof's object exists again.
 * `skipped-unverified`: a proof couldn't be checked (guild unavailable, no
 * access, a Discord error or the REST budget spent), so nothing was written.
 */
export type StepOutcome = StoreOutcome | 'skipped-not-missing' | 'skipped-unverified' | 'failed';

export interface StepResult {
  step: RepairStep;
  outcome: StepOutcome;
  /** Why a `failed` step failed. */
  error?: string;
}

export interface RepairResult {
  /** In the order the steps ran. */
  results: StepResult[];
  counts: Record<StepOutcome, number>;
}

export interface RepairActor {
  userId: string;
  source: Exclude<AuditSource, 'system'>;
  /** When the check the plan came from ran (`report.checkedAt`), for the audit row. */
  checkedAt: string;
}

export interface ApplyDeps {
  store: RepairStore;
  /** Budget for the thread and message proofs. Default: a fresh one per run. */
  rest: RestFetcher;
  invalidateGuildCaches(guildId: string): void;
  invalidateBaitCaches(client: Client, guildId: string): void;
  requestGuildCommandRefresh(guildId: string): void;
  writeAuditLog(
    guildId: string,
    action: string,
    triggeredBy: string,
    details: Record<string, unknown>,
    source: AuditSource,
  ): Promise<void>;
}

const OUTCOMES: readonly StepOutcome[] = [
  'applied',
  'stale',
  'gone',
  'exists',
  'skipped-not-missing',
  'skipped-unverified',
  'failed',
];
/** Sets, then deletes, then inserts and commands (later PRs), so a command sync sees the final rows. */
const OP_ORDER: Readonly<Record<string, number>> = { set: 0, delete: 1, insert: 2, command: 3 };
const AUDIT_MAX_STEPS = 100;
const AUDIT_MAX_VALUE = 200;

const DEFAULTED = [
  'store',
  'invalidateGuildCaches',
  'invalidateBaitCaches',
  'requestGuildCommandRefresh',
  'writeAuditLog',
] as const;

async function withDefaults(deps: Partial<ApplyDeps>): Promise<ApplyDeps> {
  if (DEFAULTED.every(name => deps[name])) return { rest: createRestFetcher(), ...deps } as ApplyDeps;
  const [caches, gating, audit] = await Promise.all([
    import('../../offboarding/guildCaches'),
    import('../../setup/commandGating'),
    import('../../api/handlers/auditHelper'),
  ]);
  const defaults: Omit<ApplyDeps, 'rest'> = {
    store: deps.store ?? createRepairStore(await appRepairDb()),
    invalidateGuildCaches: caches.invalidateGuildCaches,
    invalidateBaitCaches: caches.invalidateBaitCaches,
    requestGuildCommandRefresh: gating.requestGuildCommandRefresh,
    writeAuditLog: audit.writeAuditLog,
  };
  return { rest: createRestFetcher(), ...defaults, ...deps };
}

function write(store: RepairStore, step: RepairStep): Promise<StoreOutcome> {
  switch (step.op) {
    case 'set':
      return store.set(step.entity, step.where, step.guard, step.set ?? {});
    case 'delete':
      return store.delete(step.entity, step.where, step.guard, step.cascade);
  }
}

async function applyStep(guild: Guild, step: RepairStep, deps: ApplyDeps): Promise<StepResult> {
  try {
    if (step.where.guildId !== guild.id) throw new Error(`Step is scoped to guild ${step.where.guildId}`);
    for (const proof of step.proofs) {
      const status = await verifyProof(guild, proof, deps.rest);
      if (status === 'ok') return { step, outcome: 'skipped-not-missing' };
      if (status !== 'missing') return { step, outcome: 'skipped-unverified' };
    }
    return { step, outcome: await write(deps.store, step) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    enhancedLogger.warn(`Repair step on ${step.entity} failed`, LogCategory.DATABASE, {
      guildId: guild.id,
      keys: step.keys,
      error: message,
    });
    return { step, outcome: 'failed', error: message };
  }
}

function flushCaches(guild: Guild, deps: ApplyDeps): void {
  try {
    deps.invalidateGuildCaches(guild.id);
    deps.invalidateBaitCaches(guild.client, guild.id);
    deps.requestGuildCommandRefresh(guild.id);
  } catch (error) {
    enhancedLogger.warn('Repair cache flush failed', LogCategory.SYSTEM, {
      guildId: guild.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** JSON values longer than the cap become a cut-off string, so one long list can't bloat the audit row. */
function clip(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => {
      const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
      return [field, text.length > AUDIT_MAX_VALUE ? `${text.slice(0, AUDIT_MAX_VALUE - 1)}…` : value];
    }),
  );
}

function auditDetails(plan: RepairPlan, result: RepairResult, checkedAt: string): Record<string, unknown> {
  const codeOf = new Map(plan.fixes.map(fix => [fix.key, fix.code]));
  const steps = result.results.slice(0, AUDIT_MAX_STEPS).map(({ step, outcome }) => ({
    entity: step.entity,
    rowId: step.where.id ?? step.where.guildId,
    op: step.op,
    outcome,
    codes: [...new Set(step.keys.map(key => codeOf.get(key) ?? key))],
    guard: clip(step.guard),
    ...(step.set ? { set: clip(step.set) } : {}),
  }));
  const omitted = result.results.length - steps.length;
  return { checkedAt, counts: result.counts, steps, ...(omitted > 0 ? { stepsOmitted: omitted } : {}) };
}

/**
 * Applies `plan` to `guild`. Throws `RepairBusyError` while another repair of
 * the guild runs; otherwise every step gets a result, even one that fails.
 */
export async function applyRepairPlan(
  guild: Guild,
  plan: RepairPlan,
  actor: RepairActor,
  deps: Partial<ApplyDeps> = {},
): Promise<RepairResult> {
  const release = tryLockGuildRepair(guild.id);
  if (!release) throw new RepairBusyError(guild.id);
  try {
    const resolved = await withDefaults(deps);
    const ordered = [...plan.steps].sort((a, b) => OP_ORDER[a.op] - OP_ORDER[b.op]);
    const results: StepResult[] = [];
    for (const step of ordered) results.push(await applyStep(guild, step, resolved));

    const counts = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0])) as Record<StepOutcome, number>;
    for (const { outcome } of results) counts[outcome]++;
    const result = { results, counts };
    if (counts.applied > 0) flushCaches(guild, resolved);

    const action = actor.source === 'command' ? 'command:bot-health:repair' : 'bot-health.repair';
    const details = auditDetails(plan, result, actor.checkedAt);
    await resolved.writeAuditLog(guild.id, action, actor.userId, details, actor.source);
    return result;
  } finally {
    release();
  }
}
