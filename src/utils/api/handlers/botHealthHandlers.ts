/**
 * Bot-health API handlers (NindroidA/cogworks-bot#41): `/bot-health` for the
 * dashboard.
 *
 *   GET  /internal/guilds/:guildId/bot-health/report?system=&deep=0|1
 *   POST /internal/guilds/:guildId/bot-health/repair
 *
 * The report is cached for 60 s per (server, system, deep). A repair always
 * checks afresh, re-plans the requested fixes on that check's rows and, unless
 * it's a dry run, applies them as the dashboard user. Every fresh check is
 * metered by a slot `/bot-health` shares (`BOT_HEALTH_ACTIONS`): a dry run
 * takes the check slot, a repair one of the repair slots, a deep one also the
 * deep slot, and a slot is given back when what it paid for didn't run. The
 * server comes only from the path.
 */
import type { Client, Guild } from 'discord.js';
import { applyRepairPlan, type RepairActor, type RepairResult } from '../../health/repair/applier';
import { RepairBusyError } from '../../health/repair/lock';
import { planRepairs } from '../../health/repair/planner';
import {
  type SerializedPlan,
  type SerializedReport,
  serializePlan,
  serializeReport,
  serializeResults,
  serializeStep,
} from '../../health/repair/serialize';
import type { RepairPlan } from '../../health/repair/types';
import { runHealthCheckWithContext } from '../../health/runner';
import { HEALTH_SYSTEM_CHOICES } from '../../health/systems';
import type { HealthSystem } from '../../health/types';
import { enhancedLogger, LogCategory } from '../../monitoring/enhancedLogger';
import {
  BOT_HEALTH_ACTIONS,
  createRateLimitKey,
  type RateLimitConfig,
  RateLimits,
  rateLimiter,
} from '../../security/rateLimiter';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalBoolean, optionalEnum, requireString } from '../helpers';
import type { RouteHandler } from '../router';

/** How long a report is served from the cache. */
export const REPORT_TTL_MS = 60_000;
/** The most reports the cache holds; past it the oldest goes first. */
export const MAX_CACHED_REPORTS = 200;
/** At most this many finding keys per repair request. */
export const MAX_REPAIR_KEYS = 1_000;
const KEY_RE = /^[0-9a-f]{16}$/;

type Slot = { action: string; limit: RateLimitConfig };
const SLOTS = {
  check: { action: BOT_HEALTH_ACTIONS.check, limit: RateLimits.BOT_HEALTH_CHECK },
  deep: { action: BOT_HEALTH_ACTIONS.deep, limit: RateLimits.BOT_HEALTH_DEEP },
  repair: { action: BOT_HEALTH_ACTIONS.repair, limit: RateLimits.BOT_HEALTH_REPAIR },
} as const satisfies Record<string, Slot>;

/** The counts of a request that had nothing to write. */
const NOTHING_APPLIED: RepairResult['counts'] = {
  applied: 0,
  stale: 0,
  gone: 0,
  exists: 0,
  'skipped-not-missing': 0,
  'skipped-unverified': 0,
  failed: 0,
};

/** Test seams. */
export interface BotHealthApiDeps {
  runHealthCheckWithContext: typeof runHealthCheckWithContext;
  applyRepairPlan(guild: Guild, plan: RepairPlan, actor: RepairActor): Promise<RepairResult>;
  now(): number;
}

/** What GET returns, and what a repair returns about the check it ran. */
interface ReportView {
  report: SerializedReport;
  plan: SerializedPlan;
}

/** A dry run writes nothing, so it needs no user to audit. */
type RepairRequest = {
  system?: HealthSystem;
  deep: boolean;
  auto: boolean;
  keys: string[];
} & ({ dryRun: true } | { dryRun: false; triggeredBy: string });

const SYSTEMS = ['all', ...HEALTH_SYSTEM_CHOICES] as const;
const toSystem = (system: string | undefined) => (system && system !== 'all' ? (system as HealthSystem) : undefined);

function parseQuery(url: string): { system?: HealthSystem; deep: boolean } {
  const params = new URL(url, 'http://localhost').searchParams;
  const system = params.get('system') || undefined;
  if (system && !(SYSTEMS as readonly string[]).includes(system)) {
    throw ApiError.badRequest(`system must be one of: ${SYSTEMS.join(', ')}`);
  }
  const deep = params.get('deep') ?? '0';
  if (deep !== '0' && deep !== '1') throw ApiError.badRequest('deep must be 0 or 1');
  return { system: toSystem(system), deep: deep === '1' };
}

function parseKeys(body: Record<string, unknown>): string[] {
  const keys = body.keys;
  if (keys === undefined || keys === null) return [];
  if (!Array.isArray(keys)) throw ApiError.badRequest('keys must be an array');
  if (keys.length > MAX_REPAIR_KEYS) throw ApiError.badRequest(`keys can hold at most ${MAX_REPAIR_KEYS} entries`);
  if (!keys.every(key => typeof key === 'string' && KEY_RE.test(key))) {
    throw ApiError.badRequest('keys must be finding keys (16 lowercase hex characters)');
  }
  return [...new Set(keys as string[])];
}

/** Validates the whole body before anything runs. `body.guildId` is never read. */
function parseRepairBody(body: Record<string, unknown>): RepairRequest {
  const request = {
    system: toSystem(optionalEnum(body, 'system', SYSTEMS)),
    deep: optionalBoolean(body, 'deep') ?? false,
    auto: optionalBoolean(body, 'auto') ?? false,
    keys: parseKeys(body),
  };
  const dryRun = optionalBoolean(body, 'dryRun') ?? false;
  if (!request.auto && request.keys.length === 0) throw ApiError.badRequest('Select fixes with keys, auto, or both');
  if (dryRun) return { ...request, dryRun };
  const triggeredBy = requireString(body, 'triggeredBy');
  if (!isValidSnowflake(triggeredBy)) throw ApiError.badRequest('triggeredBy must be a Discord user ID');
  return { ...request, dryRun, triggeredBy };
}

/** Takes one use of each slot for the server, in order; a refusal gives back the ones taken and is a 429. */
function takeSlots(guildId: string, slots: readonly Slot[]): string[] {
  const taken: string[] = [];
  for (const { action, limit } of slots) {
    const key = createRateLimitKey.guild(guildId, action);
    const check = rateLimiter.check(key, limit);
    if (!check.allowed) {
      refund(taken);
      throw ApiError.tooManyRequests(check.message ?? 'Rate limit exceeded');
    }
    taken.push(key);
  }
  return taken;
}

function refund(keys: readonly string[]): void {
  for (const key of keys) rateLimiter.refund(key);
}

/** Registers the routes. Returns the cache's size, for tests. */
export function registerBotHealthHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
  overrides: Partial<BotHealthApiDeps> = {},
): { cacheSize(): number } {
  const deps: BotHealthApiDeps = { runHealthCheckWithContext, applyRepairPlan, now: Date.now, ...overrides };
  const cache = new Map<string, { at: number; view: ReportView }>();
  /** Bumped by every repair, so a check that started before one never caches what it read. */
  const generations = new Map<string, number>();
  /** When the API last took each server's deep slot. */
  const deepCharges = new Map<string, number>();
  const cacheKey = (guildId: string, system: HealthSystem | undefined, deep: boolean) =>
    `${guildId}|${system ?? 'all'}|${deep ? 1 : 0}`;

  const guildOf = (guildId: string): Guild => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');
    return guild;
  };

  const cached = (key: string): ReportView | null => {
    const entry = cache.get(key);
    return entry && deps.now() - entry.at < REPORT_TTL_MS ? entry.view : null;
  };

  const store = (key: string, view: ReportView) => {
    const now = deps.now();
    for (const [k, entry] of cache) if (now - entry.at >= REPORT_TTL_MS) cache.delete(k);
    for (const [g, at] of deepCharges) if (now - at >= SLOTS.deep.limit.windowMs) deepCharges.delete(g);
    cache.delete(key); // re-added last: the newest
    while (cache.size >= MAX_CACHED_REPORTS) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, view });
  };

  /** Drops the server's reports after a repair changed what they say. */
  const invalidate = (guildId: string) => {
    generations.set(guildId, (generations.get(guildId) ?? 0) + 1);
    for (const key of cache.keys()) if (key.startsWith(`${guildId}|`)) cache.delete(key);
  };

  /** Records that the API took the server's deep slot; the returned function undoes it with a refund. */
  const chargedDeep = (guildId: string) => {
    const before = deepCharges.get(guildId);
    deepCharges.set(guildId, deps.now());
    return () => (before === undefined ? deepCharges.delete(guildId) : deepCharges.set(guildId, before));
  };

  /**
   * A deep preview or repair needs no deep slot of its own while the API's
   * last deep charge for the server is within the slot's window, so a deep
   * report can be followed by a deep dry run and a deep repair.
   */
  const deepCovered = (guildId: string) => {
    const at = deepCharges.get(guildId);
    return at !== undefined && deps.now() - at < SLOTS.deep.limit.windowMs;
  };

  /** Runs the check, plans every fix, and caches what GET would return for these options. */
  const freshCheck = async (guild: Guild, system: HealthSystem | undefined, deep: boolean) => {
    const generation = generations.get(guild.id) ?? 0;
    const { report, ctx } = await deps.runHealthCheckWithContext(guild, { system, deep });
    const plan = planRepairs(report, ctx);
    const view: ReportView = { report: serializeReport(report, plan), plan: serializePlan(plan) };
    if ((generations.get(guild.id) ?? 0) === generation) store(cacheKey(guild.id, system, deep), view);
    return { report, ctx, plan, view };
  };

  /**
   * The check after a repair takes no repair slot. It runs deep only while
   * the deep slot is free, as `/bot-health repair` does, so a repair never
   * runs deep more often than the limit. Null when it fails.
   */
  const recheck = async (guild: Guild, system: HealthSystem | undefined, deep: boolean) => {
    const deepKey = createRateLimitKey.guild(guild.id, SLOTS.deep.action);
    const runDeep = deep && rateLimiter.check(deepKey, SLOTS.deep.limit).allowed;
    const undo = runDeep ? chargedDeep(guild.id) : null;
    try {
      return (await freshCheck(guild, system, runDeep)).view;
    } catch (error) {
      if (undo) {
        rateLimiter.refund(deepKey);
        undo();
      }
      enhancedLogger.warn('bot-health API: re-check after repair failed', LogCategory.API, {
        guildId: guild.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  // GET /internal/guilds/:guildId/bot-health/report?system=&deep=0|1
  routes.set('GET /bot-health/report', async (guildId, _body, url) => {
    const { system, deep } = parseQuery(url);
    const guild = guildOf(guildId);
    const hit = cached(cacheKey(guildId, system, deep));
    if (hit) return { ...hit };
    const slots = deep ? takeSlots(guildId, [SLOTS.deep]) : [];
    const undo = deep ? chargedDeep(guildId) : null;
    try {
      return { ...(await freshCheck(guild, system, deep)).view };
    } catch (error) {
      refund(slots);
      undo?.();
      throw error;
    }
  });

  // POST /internal/guilds/:guildId/bot-health/repair
  // Body: { keys?, auto?, dryRun?, system?, deep?, triggeredBy } (triggeredBy unless dryRun).
  routes.set('POST /bot-health/repair', async (guildId, body) => {
    const request = parseRepairBody(body);
    const { system, deep } = request;
    const guild = guildOf(guildId);
    // The repair slot is first, as in the command, so slots[0] is always the one this request is metered by.
    const chargeDeep = deep && !deepCovered(guildId);
    const first = request.dryRun ? SLOTS.check : SLOTS.repair;
    const slots = takeSlots(guildId, chargeDeep ? [first, SLOTS.deep] : [first]);
    const undo = chargeDeep ? chargedDeep(guildId) : null;

    let check: Awaited<ReturnType<typeof freshCheck>>;
    try {
      check = await freshCheck(guild, system, deep);
    } catch (error) {
      refund(slots);
      undo?.();
      throw error;
    }
    // `auto` means every automatic fix this check found, which may differ from an earlier preview's.
    const autoKeys = request.auto ? check.plan.fixes.filter(fix => fix.repair === 'auto').map(fix => fix.key) : [];
    const plan = planRepairs(check.report, check.ctx, { keys: [...autoKeys, ...request.keys] });
    const fixed = new Set(check.plan.fixes.map(fix => fix.key));
    const keysNotFound = request.keys.filter(key => !fixed.has(key));

    if (request.dryRun) return { dryRun: true, ...check.view, steps: plan.steps.map(serializeStep), keysNotFound };
    // Nothing to write: no repair runs and no audit row is written. The slot paid for the check, so it's kept.
    if (plan.steps.length === 0)
      return { dryRun: false, results: [], counts: NOTHING_APPLIED, ...check.view, keysNotFound };

    const actor: RepairActor = { userId: request.triggeredBy, source: 'dashboard', checkedAt: check.report.checkedAt };
    let result: RepairResult;
    try {
      result = await deps.applyRepairPlan(guild, plan, actor);
    } catch (error) {
      // No repair ran; the check did, so only the repair slot goes back.
      refund(slots.slice(0, 1));
      if (error instanceof RepairBusyError) throw ApiError.conflict('A repair is already running for this server');
      throw error;
    }

    invalidate(guildId);
    const after = await recheck(guild, system, deep);
    const results = serializeResults(result);
    return {
      dryRun: false,
      results,
      counts: result.counts,
      report: after?.report ?? null,
      plan: after?.plan ?? null,
      keysNotFound,
    };
  });

  return { cacheSize: () => cache.size };
}
