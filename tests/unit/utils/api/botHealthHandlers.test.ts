/**
 * Bot-health API: GET /bot-health/report and POST /bot-health/repair, called
 * as the router calls them. The check is a fake over one mutable XP row and a
 * ticket panel, so a repair's writes show up in the next check. The real
 * planner, applier and guild lock run, with a fake store, cache flushes and
 * audit writer. The rate limiter is the real singleton: the keys the
 * `/bot-health` command takes are the ones these endpoints must share.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Client, Guild } from 'discord.js';
import { ApiError } from '../../../../src/utils/api/apiError';
import {
  type BotHealthApiDeps,
  MAX_REPAIR_KEYS,
  REPORT_TTL_MS,
  registerBotHealthHandlers,
} from '../../../../src/utils/api/handlers/botHealthHandlers';
import { type RouteHandler, registerHandlers } from '../../../../src/utils/api/router';
import { type ApplyDeps, applyRepairPlan } from '../../../../src/utils/health/repair/applier';
import { findingKey } from '../../../../src/utils/health/repair/keys';
import { tryLockGuildRepair } from '../../../../src/utils/health/repair/lock';
import { repairLabel } from '../../../../src/utils/health/repair/refRepairs';
import { buildReport } from '../../../../src/utils/health/runner';
import type { CheckResult, HealthFinding } from '../../../../src/utils/health/types';
import { createRateLimitKey, RateLimits, rateLimiter } from '../../../../src/utils/security/rateLimiter';
import { makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

const G = '100000000000000001';
const OTHER = '100000000000000002';
const USER = '900000000000000001';
const TEXT = '300000000000000001';
const GONE_CH = '300000000000000666';
const GONE_MSG = '500000000000000666';
const UNKNOWN_KEY = '0123456789abcdef';

const repairKey = (guildId: string) => createRateLimitKey.guild(guildId, 'bot-health-repair');
const deepKey = (guildId: string) => createRateLimitKey.guild(guildId, 'bot-health-deep');
const repairsLeft = (guildId = G) => rateLimiter.getRemaining(repairKey(guildId), RateLimits.BOT_HEALTH_REPAIR.maxAttempts);
const deepLeft = (guildId = G) => rateLimiter.getRemaining(deepKey(guildId), RateLimits.BOT_HEALTH_DEEP.maxAttempts);

type Row = Record<string, unknown>;

const levelUp: HealthFinding = {
  code: 'xp.config.level_up_channel_missing',
  system: 'xp',
  severity: 'degraded',
  repair: 'auto',
  entity: 'XPConfig',
  rowId: 5,
  field: 'levelUpChannelId',
  refId: GONE_CH,
  params: { channelId: GONE_CH },
};
const rateInverted = (xp: Row): HealthFinding => ({
  code: 'xp.config.rate_inverted',
  system: 'xp',
  severity: 'degraded',
  repair: 'confirm',
  entity: 'XPConfig',
  rowId: 5,
  field: 'xpPerMessageMin',
  params: { min: xp.xpPerMessageMin as number, max: xp.xpPerMessageMax as number },
});
/** Confirm, but repair has no action for it: unsupported. */
const panelMessage: HealthFinding = {
  code: 'ticket.panel.message_missing',
  system: 'ticket',
  severity: 'block',
  repair: 'confirm',
  entity: 'TicketConfig',
  rowId: 1,
  field: 'messageId',
  refId: GONE_MSG,
  params: { channelId: TEXT },
};
/** Manual: never in the plan. */
const categoryUnset: HealthFinding = {
  code: 'ticket.panel.category_unset',
  system: 'ticket',
  severity: 'block',
  repair: 'manual',
  entity: 'TicketConfig',
  rowId: 1,
  field: 'categoryId',
  params: {},
};

const LEVEL_KEY = findingKey(levelUp);
const PANEL_KEY = findingKey(panelMessage);

interface Harness {
  xp: Row;
  calls: { guildId: string; system?: string; deep: boolean }[];
  writes: { op: string; entity: string; where: Row; set?: Row }[];
  audits: unknown[][];
  failCheck: boolean;
  failApply: boolean;
  advance(ms: number): void;
  get(query?: string, guildId?: string): Promise<Record<string, any>>;
  post(body: Record<string, unknown>, guildId?: string): Promise<Record<string, any>>;
}

function setup(): Harness {
  const h = {
    xp: { id: 5, levelUpChannelId: GONE_CH, xpPerMessageMin: 30, xpPerMessageMax: 10 } as Row,
    calls: [],
    writes: [],
    audits: [],
    failCheck: false,
    failApply: false,
  } as unknown as Harness;
  let now = 1_000_000;
  h.advance = ms => {
    now += ms;
  };

  const run: BotHealthApiDeps['runHealthCheckWithContext'] = async (guild, opts = {}) => {
    const deep = opts.deep ?? false;
    h.calls.push({ guildId: guild.id, system: opts.system, deep });
    if (h.failCheck) throw new Error('database down');
    const xp = structuredClone(h.xp);
    const xpFindings = [
      ...(xp.levelUpChannelId === GONE_CH ? [levelUp] : []),
      ...((xp.xpPerMessageMin as number) > (xp.xpPerMessageMax as number) ? [rateInverted(xp)] : []),
    ];
    const results: CheckResult[] = [
      { checkId: 'ticket.panel', system: 'ticket', configured: true, findings: [panelMessage, categoryUnset] },
      { checkId: 'xp.config', system: 'xp', configured: true, findings: xpFindings },
    ].filter(r => !opts.system || r.system === opts.system) as CheckResult[];
    const checkedAt = new Date(Date.UTC(2026, 9, 7, 12, 0, h.calls.length)).toISOString();
    const report = buildReport(results, { guildId: guild.id, botVersion: 'test', checkedAt, deep, notChecked: [] });
    return { report, ctx: makeCheckContext({ guild, deep, rows: { XPConfig: [xp] } }) };
  };

  const applyDeps: Partial<ApplyDeps> = {
    store: {
      set: async (entity, where, _guard, set) => {
        h.writes.push({ op: 'set', entity, where, set });
        Object.assign(h.xp, set);
        return 'applied';
      },
      delete: async (entity, where) => {
        h.writes.push({ op: 'delete', entity, where });
        return 'applied';
      },
      insert: async (entity, values) => {
        h.writes.push({ op: 'insert', entity, where: values });
        return 'applied';
      },
    },
    invalidateGuildCaches: () => {},
    invalidateBaitCaches: () => {},
    requestGuildCommandRefresh: () => {},
    registerGuildCommands: async () => {},
    writeAuditLog: async (...args) => {
      h.audits.push(args);
    },
  };

  const guilds = new Map<string, Guild>([G, OTHER].map(id => [id, makeFakeGuild({ id, channels: [{ id: TEXT }] })]));
  const client = { guilds: { cache: guilds } } as unknown as Client;
  const routes = new Map<string, RouteHandler>();
  registerBotHealthHandlers(client, routes, {
    runHealthCheckWithContext: run,
    applyRepairPlan: async (guild, plan, actor) => {
      if (h.failApply) throw new Error('engine failed');
      return applyRepairPlan(guild, plan, actor, applyDeps);
    },
    now: () => now,
  });
  const report = routes.get('GET /bot-health/report') as RouteHandler;
  const repair = routes.get('POST /bot-health/repair') as RouteHandler;
  h.get = (query = '', guildId = G) => report(guildId, {}, `/internal/guilds/${guildId}/bot-health/report${query}`);
  h.post = (body, guildId = G) => repair(guildId, body, `/internal/guilds/${guildId}/bot-health/repair`);
  return h;
}

/** The HTTP status the internal API server would send for this call. */
async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 200;
  } catch (error) {
    return error instanceof ApiError ? error.statusCode : 500;
  }
}

const findingsOf = (res: Record<string, any>, system: string) => res.report.systems[system].findings as any[];

const origRelease = process.env.RELEASE;
beforeEach(() => {
  process.env.RELEASE = 'prod';
  rateLimiter.destroy(); // forget a dev-mode reading cached by another suite
});
afterEach(() => {
  (rateLimiter as unknown as { limits: Map<string, unknown> }).limits.clear();
  rateLimiter.destroy();
});
afterAll(() => {
  process.env.RELEASE = origRelease;
});

describe('bot-health routes', () => {
  test('are guild-scoped under /bot-health, clear of /internal/health', () => {
    const routes = new Map<string, RouteHandler>();
    registerBotHealthHandlers({} as Client, routes);
    expect([...routes.keys()]).toEqual(['GET /bot-health/report', 'POST /bot-health/repair']);

    const all = registerHandlers({} as Client);
    expect(all.has('GET /bot-health/report')).toBe(true);
    expect(all.has('POST /bot-health/repair')).toBe(true);
    expect(all.has('GET /internal/health')).toBe(true);
  });
});

describe('GET /bot-health/report', () => {
  test("each finding has its key, filled text and fix; the plan lists fixes and what it can't fix, no writes", async () => {
    const h = setup();
    const res = await h.get();

    const xp = findingsOf(res, 'xp');
    expect(xp.map(f => [f.code, f.key, f.fixable, f.label])).toEqual([
      [levelUp.code, LEVEL_KEY, true, repairLabel(levelUp.code)],
      ['xp.config.rate_inverted', findingKey(rateInverted(h.xp)), true, repairLabel('xp.config.rate_inverted')],
    ]);
    expect(xp[0].text).toContain(`\`${GONE_CH}\``);
    expect(xp[1].text).toContain('minimum 30, maximum 10');
    expect(xp.every(f => !f.text.includes('{'))).toBe(true);

    const ticket = findingsOf(res, 'ticket');
    expect(ticket.map(f => [f.code, f.fixable, f.label])).toEqual([
      [panelMessage.code, false, null],
      [categoryUnset.code, false, null],
    ]);
    expect(ticket[0].text).toContain(`<#${TEXT}>`);

    expect(res.plan.fixes.map((f: any) => [f.key, f.repair, f.op])).toEqual([
      [LEVEL_KEY, 'auto', 'set'],
      [findingKey(rateInverted(h.xp)), 'confirm', 'set'],
    ]);
    expect(res.plan.unsupported).toEqual([{ key: PANEL_KEY, code: panelMessage.code, reason: 'no_action' }]);
    expect(Object.keys(res.plan).sort()).toEqual(['fixes', 'unsupported']);
    expect(res.report.counts).toEqual({ auto: 1, confirm: 2, manual: 1 });
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  test('system and deep reach the check; anything else is a 400 that runs nothing', async () => {
    const h = setup();
    const xpOnly = await h.get('?system=xp');
    expect(Object.keys(xpOnly.report.systems)).toEqual(['xp']);
    await h.get('?system=all&deep=0');
    expect(h.calls.map(c => [c.system, c.deep])).toEqual([
      ['xp', false],
      [undefined, false],
    ]);

    for (const query of ['?system=nope', '?system=baitchannel', '?deep=2', '?deep=true']) {
      expect(await statusOf(h.get(query))).toBe(400);
    }
    expect(h.calls).toHaveLength(2);
  });

  test('a report is served from the cache for 60 s per server, system and deep', async () => {
    const h = setup();
    const first = await h.get();
    expect((await h.get()).report.checkedAt).toBe(first.report.checkedAt);
    expect(h.calls).toHaveLength(1);

    await h.get('?system=xp');
    await h.get('', OTHER);
    expect(h.calls.map(c => [c.guildId, c.system])).toEqual([
      [G, undefined],
      [G, 'xp'],
      [OTHER, undefined],
    ]);

    h.advance(REPORT_TTL_MS - 1);
    await h.get();
    expect(h.calls).toHaveLength(3);
    h.advance(1);
    expect((await h.get()).report.checkedAt).not.toBe(first.report.checkedAt);
    expect(h.calls).toHaveLength(4);
  });

  test("a deep report takes the server's deep slot, shared with /bot-health check; refused is a 429", async () => {
    const h = setup();
    // The command's deep check took the slot.
    rateLimiter.check(deepKey(G), RateLimits.BOT_HEALTH_DEEP);
    expect(await statusOf(h.get('?deep=1'))).toBe(429);
    expect(h.calls).toEqual([]);
    expect(await statusOf(h.get('?deep=0'))).toBe(200);

    // On another server the API takes it, so the command would be refused; a cached deep report needs no slot.
    await h.get('?deep=1', OTHER);
    expect(deepLeft(OTHER)).toBe(0);
    expect(await statusOf(h.get('?deep=1', OTHER))).toBe(200);
    h.advance(REPORT_TTL_MS);
    expect(await statusOf(h.get('?deep=1', OTHER))).toBe(429);
    expect(h.calls.map(c => [c.guildId, c.deep])).toEqual([
      [G, false],
      [OTHER, true],
    ]);
  });

  test('a deep check that fails gives its slot back', async () => {
    const h = setup();
    h.failCheck = true;
    expect(await statusOf(h.get('?deep=1'))).toBe(500);
    expect(deepLeft()).toBe(1);
  });
});

describe('POST /bot-health/repair', () => {
  test('dryRun returns the merged steps with before and after, and writes nothing', async () => {
    const h = setup();
    const rateKey = findingKey(rateInverted(h.xp));
    // Even while a repair holds the lock: a dry run never takes it.
    const release = tryLockGuildRepair(G);
    try {
      const res = await h.post({ dryRun: true, auto: true, keys: [rateKey] });
      expect(res.dryRun).toBe(true);
      expect(res.steps).toEqual([
        {
          entity: 'XPConfig',
          rowId: 5,
          op: 'set',
          keys: [LEVEL_KEY, rateKey],
          before: { levelUpChannelId: GONE_CH, xpPerMessageMin: 30, xpPerMessageMax: 10 },
          after: { levelUpChannelId: null, xpPerMessageMin: 10, xpPerMessageMax: 30 },
        },
      ]);
      expect(res.keysNotFound).toEqual([]);
      expect(res.plan.fixes).toHaveLength(2);
      expect(findingsOf(res, 'xp')).toHaveLength(2);

      // auto alone leaves the confirm fix out.
      const autoOnly = await h.post({ dryRun: true, auto: true });
      expect(autoOnly.steps.map((s: any) => [s.keys, s.after])).toEqual([[[LEVEL_KEY], { levelUpChannelId: null }]]);
    } finally {
      release?.();
    }
    expect(h.writes).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(repairsLeft()).toBe(RateLimits.BOT_HEALTH_REPAIR.maxAttempts);
    expect(h.calls).toHaveLength(2);
  });

  test('applying needs a valid triggeredBy, and a bad body is a 400 that runs nothing', async () => {
    const h = setup();
    const bodies: Record<string, unknown>[] = [
      { auto: true },
      { auto: true, triggeredBy: 'dashboard' },
      { auto: true, triggeredBy: 42 },
      { triggeredBy: USER },
      { keys: [], triggeredBy: USER },
      { auto: false, triggeredBy: USER },
      { keys: LEVEL_KEY, triggeredBy: USER },
      { keys: [LEVEL_KEY.toUpperCase()], triggeredBy: USER },
      { keys: [LEVEL_KEY, 7], triggeredBy: USER },
      { keys: Array(MAX_REPAIR_KEYS + 1).fill(LEVEL_KEY), triggeredBy: USER },
      { auto: 'yes', triggeredBy: USER },
      { auto: true, deep: 1, triggeredBy: USER },
      { auto: true, dryRun: 'true' },
      { auto: true, system: 'nope', triggeredBy: USER },
      { auto: true, system: 'baitchannel', triggeredBy: USER },
    ];
    for (const body of bodies) expect([body, await statusOf(h.post(body))]).toEqual([body, 400]);
    expect(h.calls).toEqual([]);
    expect(repairsLeft()).toBe(RateLimits.BOT_HEALTH_REPAIR.maxAttempts);
  });

  test('applies the picked fixes as the dashboard user, then returns a fresh report', async () => {
    const h = setup();
    const before = await h.get();
    const res = await h.post({ auto: true, triggeredBy: USER, system: 'xp' });

    expect(h.writes).toEqual([
      { op: 'set', entity: 'XPConfig', where: { guildId: G, id: 5 }, set: { levelUpChannelId: null } },
    ]);
    expect(res.results).toEqual([
      {
        entity: 'XPConfig',
        rowId: 5,
        op: 'set',
        keys: [LEVEL_KEY],
        before: { levelUpChannelId: GONE_CH },
        after: { levelUpChannelId: null },
        outcome: 'applied',
      },
    ]);
    expect(res.counts.applied).toBe(1);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0].slice(0, 3)).toEqual([G, 'bot-health.repair', USER]);
    expect(h.audits[0][4]).toBe('dashboard');

    // The check before the repair and the one after, with the request's options.
    expect(h.calls.slice(1).map(c => [c.system, c.deep])).toEqual([
      ['xp', false],
      ['xp', false],
    ]);
    expect(findingsOf(res, 'xp').map(f => f.code)).toEqual(['xp.config.rate_inverted']);
    expect(res.plan.fixes.map((f: any) => f.code)).toEqual(['xp.config.rate_inverted']);
    expect(res.keysNotFound).toEqual([]);

    // GET serves the report after the repair, and no longer the cached one from before it.
    expect((await h.get('?system=xp')).report).toEqual(res.report);
    expect(h.calls).toHaveLength(3);
    const all = await h.get();
    expect(h.calls).toHaveLength(4);
    expect(findingsOf(before, 'xp')).toHaveLength(2);
    expect(findingsOf(all, 'xp').map(f => f.code)).toEqual(['xp.config.rate_inverted']);
  });

  test("takes one of the server's repair slots, the one /bot-health repair takes", async () => {
    const h = setup();
    await h.post({ auto: true, triggeredBy: USER });
    expect(repairsLeft()).toBe(RateLimits.BOT_HEALTH_REPAIR.maxAttempts - 1);

    // The command used the rest of this hour's repairs.
    for (let i = 1; i < RateLimits.BOT_HEALTH_REPAIR.maxAttempts; i++) {
      expect(rateLimiter.check(repairKey(G), RateLimits.BOT_HEALTH_REPAIR).allowed).toBe(true);
    }
    const calls = h.calls.length;
    expect(await statusOf(h.post({ auto: true, triggeredBy: USER }))).toBe(429);
    expect(h.calls).toHaveLength(calls);
    // A dry run writes nothing and takes no repair slot.
    expect(await statusOf(h.post({ auto: true, dryRun: true }))).toBe(200);
  });

  test('a deep repair also takes the deep slot; refused, the repair slot goes back', async () => {
    const h = setup();
    rateLimiter.check(deepKey(G), RateLimits.BOT_HEALTH_DEEP);
    expect(await statusOf(h.post({ auto: true, deep: true, triggeredBy: USER }))).toBe(429);
    expect(repairsLeft()).toBe(RateLimits.BOT_HEALTH_REPAIR.maxAttempts);
    expect(h.calls).toEqual([]);

    await h.post({ auto: true, deep: true, triggeredBy: USER }, OTHER);
    expect([repairsLeft(OTHER), deepLeft(OTHER)]).toEqual([RateLimits.BOT_HEALTH_REPAIR.maxAttempts - 1, 0]);
    expect(h.calls.map(c => c.deep)).toEqual([true, true]);
  });

  test('a repair already running is a 409, and the slot goes back', async () => {
    const h = setup();
    const release = tryLockGuildRepair(G);
    try {
      expect(await statusOf(h.post({ auto: true, triggeredBy: USER }))).toBe(409);
    } finally {
      release?.();
    }
    expect(h.writes).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(repairsLeft()).toBe(RateLimits.BOT_HEALTH_REPAIR.maxAttempts);
  });

  test('a check or apply that fails gives back the slots for what never ran', async () => {
    const h = setup();
    h.failCheck = true;
    expect(await statusOf(h.post({ auto: true, deep: true, triggeredBy: USER }))).toBe(500);
    expect([repairsLeft(), deepLeft()]).toEqual([RateLimits.BOT_HEALTH_REPAIR.maxAttempts, 1]);

    h.failCheck = false;
    h.failApply = true;
    expect(await statusOf(h.post({ auto: true, triggeredBy: USER }))).toBe(500);
    expect(repairsLeft()).toBe(RateLimits.BOT_HEALTH_REPAIR.maxAttempts);
    expect(h.writes).toEqual([]);
  });

  test("body.guildId is ignored: the path's server is checked, repaired, audited and charged", async () => {
    const h = setup();
    await h.post({ auto: true, triggeredBy: USER, guildId: OTHER });
    expect(new Set(h.calls.map(c => c.guildId))).toEqual(new Set([G]));
    expect(h.writes.map(w => w.where.guildId)).toEqual([G]);
    expect(h.audits.map(a => a[0])).toEqual([G]);
    expect([repairsLeft(G), repairsLeft(OTHER)]).toEqual([
      RateLimits.BOT_HEALTH_REPAIR.maxAttempts - 1,
      RateLimits.BOT_HEALTH_REPAIR.maxAttempts,
    ]);
  });

  test('keys without a fix are reported; the others are still applied', async () => {
    const h = setup();
    const rateKey = findingKey(rateInverted(h.xp));
    const res = await h.post({ keys: [rateKey, UNKNOWN_KEY, PANEL_KEY, rateKey], triggeredBy: USER });
    expect(res.keysNotFound).toEqual([UNKNOWN_KEY, PANEL_KEY]);
    expect(res.results.map((r: any) => [r.keys, r.outcome])).toEqual([[[rateKey], 'applied']]);
    expect(h.writes.map(w => w.set)).toEqual([{ xpPerMessageMin: 10, xpPerMessageMax: 30 }]);
  });

  test('nothing to fix: no repair, no audit row, and the slot goes back', async () => {
    const h = setup();
    const res = await h.post({ keys: [UNKNOWN_KEY], triggeredBy: USER });
    expect(res.results).toEqual([]);
    expect(Object.values(res.counts)).toEqual(Array(7).fill(0));
    expect(res.keysNotFound).toEqual([UNKNOWN_KEY]);
    expect(findingsOf(res, 'xp')).toHaveLength(2);
    expect(h.audits).toEqual([]);
    expect(repairsLeft()).toBe(RateLimits.BOT_HEALTH_REPAIR.maxAttempts);
  });
});
