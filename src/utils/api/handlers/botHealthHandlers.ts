/**
 * Bot-health API handlers (NindroidA/cogworks-bot#41): `/bot-health` for the
 * dashboard.
 *
 *   GET  /internal/guilds/:guildId/bot-health/report?system=&deep=0|1
 *   POST /internal/guilds/:guildId/bot-health/repair
 *
 * The report is cached for 60 s per (server, system, deep). A deep check that
 * isn't cached takes the server's deep slot, the one `/bot-health check
 * deep:true` takes. A repair always checks afresh, re-plans the requested
 * fixes on that check's rows and, unless it's a dry run, applies them as the
 * dashboard user, taking one of the server's `/bot-health repair` slots. A
 * slot is given back when what it paid for didn't run. The server comes only
 * from the path.
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
import { createRateLimitKey, type RateLimitConfig, RateLimits, rateLimiter } from '../../security/rateLimiter';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalBoolean, optionalEnum, requireString } from '../helpers';
import type { RouteHandler } from '../router';

/** How long a report is served from the cache. */
export const REPORT_TTL_MS = 60_000;
/** At most this many finding keys per repair request. */
export const MAX_REPAIR_KEYS = 1_000;
const KEY_RE = /^[0-9a-f]{16}$/;

/** The slots `/bot-health check` and `/bot-health repair` take, so the dashboard and the command share each limit. */
const SLOTS = {
  deep: { action: 'bot-health-deep', limit: RateLimits.BOT_HEALTH_DEEP },
  repair: { action: 'bot-health-repair', limit: RateLimits.BOT_HEALTH_REPAIR },
} as const;
type Slot = { action: string; limit: RateLimitConfig };
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

export function registerBotHealthHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
  overrides: Partial<BotHealthApiDeps> = {},
): void {
  const deps: BotHealthApiDeps = { runHealthCheckWithContext, applyRepairPlan, now: Date.now, ...overrides };
  const cache = new Map<string, { at: number; view: ReportView }>();
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

  /** Drops the server's reports, after a repair changed what they say. */
  const invalidate = (guildId: string) => {
    for (const key of cache.keys()) if (key.startsWith(`${guildId}|`)) cache.delete(key);
  };

  /** Runs the check, plans every fix, and caches what GET would return for these options. */
  const freshCheck = async (guild: Guild, system: HealthSystem | undefined, deep: boolean) => {
    const { report, ctx } = await deps.runHealthCheckWithContext(guild, { system, deep });
    const plan = planRepairs(report, ctx);
    const view: ReportView = { report: serializeReport(report, plan), plan: serializePlan(plan) };
    const now = deps.now();
    for (const [key, entry] of cache) if (now - entry.at >= REPORT_TTL_MS) cache.delete(key);
    cache.set(cacheKey(guild.id, system, deep), { at: now, view });
    return { report, ctx, plan, view };
  };

  // GET /internal/guilds/:guildId/bot-health/report?system=&deep=0|1
  routes.set('GET /bot-health/report', async (guildId, _body, url) => {
    const { system, deep } = parseQuery(url);
    const guild = guildOf(guildId);
    const hit = cached(cacheKey(guildId, system, deep));
    if (hit) return { ...hit };
    const slots = deep ? takeSlots(guildId, [SLOTS.deep]) : [];
    try {
      return { ...(await freshCheck(guild, system, deep)).view };
    } catch (error) {
      refund(slots);
      throw error;
    }
  });

  // POST /internal/guilds/:guildId/bot-health/repair
  // Body: { keys?, auto?, dryRun?, system?, deep?, triggeredBy } (triggeredBy unless dryRun).
  routes.set('POST /bot-health/repair', async (guildId, body) => {
    const request = parseRepairBody(body);
    const { system, deep } = request;
    const guild = guildOf(guildId);
    // In the command's order: the repair slot, then the deep one. A dry run writes nothing, so it takes no repair slot.
    const slots = takeSlots(guildId, [...(request.dryRun ? [] : [SLOTS.repair]), ...(deep ? [SLOTS.deep] : [])]);
    const repairSlot = request.dryRun ? [] : slots.slice(0, 1);

    let check: Awaited<ReturnType<typeof freshCheck>>;
    try {
      check = await freshCheck(guild, system, deep);
    } catch (error) {
      refund(slots);
      throw error;
    }
    const autoKeys = request.auto ? check.plan.fixes.filter(fix => fix.repair === 'auto').map(fix => fix.key) : [];
    const plan = planRepairs(check.report, check.ctx, { keys: [...autoKeys, ...request.keys] });
    const fixed = new Set(check.plan.fixes.map(fix => fix.key));
    const keysNotFound = request.keys.filter(key => !fixed.has(key));

    if (request.dryRun) return { dryRun: true, ...check.view, steps: plan.steps.map(serializeStep), keysNotFound };
    if (plan.steps.length === 0) {
      // Nothing to write: no repair ran, so no audit row and the slot goes back.
      refund(repairSlot);
      return { dryRun: false, results: [], counts: NOTHING_APPLIED, ...check.view, keysNotFound };
    }

    const actor: RepairActor = { userId: request.triggeredBy, source: 'dashboard', checkedAt: check.report.checkedAt };
    let result: RepairResult;
    try {
      result = await deps.applyRepairPlan(guild, plan, actor);
    } catch (error) {
      refund(repairSlot);
      if (error instanceof RepairBusyError) throw ApiError.conflict('A repair is already running for this server');
      throw error;
    }

    // What the server's reports said may have changed: drop them, then check again (no slot, as the command does).
    invalidate(guildId);
    let after: ReportView | null = null;
    try {
      after = (await freshCheck(guild, system, deep)).view;
    } catch (error) {
      enhancedLogger.warn('bot-health API: re-check after repair failed', LogCategory.API, {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
}
