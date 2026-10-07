/**
 * `/bot-health repair` handler: who may run it, the owner-only `guild-id`,
 * the per-guild limit (5 an hour, a deep run also takes the deep check's
 * slot, both given back when the check fails, owner bypass), and the preview
 * collector: apply-auto and apply-selected send exactly their keys, only the
 * invoker's clicks count, Administrator is checked again on apply, a busy lock
 * is reported, and the check afterwards takes no slot.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { type Guild, PermissionsBitField } from 'discord.js';
import { botHealthRepairHandler, type RepairDeps } from '../../../../src/commands/handlers/botHealth/repair';
import { REPAIR_CID } from '../../../../src/commands/handlers/botHealth/repairRender';
import type { RepairActor, RepairResult } from '../../../../src/utils/health/repair/applier';
import { findingKey } from '../../../../src/utils/health/repair/keys';
import { RepairBusyError } from '../../../../src/utils/health/repair/lock';
import type { RepairPlan } from '../../../../src/utils/health/repair/types';
import type { HealthRunOptions } from '../../../../src/utils/health/runner';
import type { HealthFinding, HealthReport } from '../../../../src/utils/health/types';
import { createRateLimitKey, rateLimiter } from '../../../../src/utils/security/rateLimiter';
import { makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

const G = '100000000000000001';
const OTHER = '100000000000000002';
const OWNER = '400000000000000001';
const ADMIN = '400000000000000002';
const ADMIN_2 = '400000000000000009';
const MEMBER = '400000000000000003';

const origOwner = process.env.BOT_OWNER_ID;
const origRelease = process.env.RELEASE;

beforeEach(() => {
  process.env.BOT_OWNER_ID = OWNER;
  process.env.RELEASE = 'prod';
});
afterEach(() => {
  (rateLimiter as unknown as { limits: Map<string, unknown> }).limits.clear();
  rateLimiter.destroy();
});
afterAll(() => {
  process.env.BOT_OWNER_ID = origOwner;
  process.env.RELEASE = origRelease;
});

const repairSlotsLeft = () => rateLimiter.getRemaining(createRateLimitKey.guild(G, 'bot-health-repair'), 5);
const deepSlotsLeft = () => rateLimiter.getRemaining(createRateLimitKey.guild(G, 'bot-health-deep'), 1);

// One automatic fix, two to confirm, one the repair can't do.
const LOCALE: HealthFinding = {
  code: 'core.locale.unsupported',
  system: 'core',
  severity: 'cosmetic',
  repair: 'auto',
  entity: 'BotConfig',
  rowId: G,
  params: { locale: 'jp' },
};
const RESTRICTION: HealthFinding = {
  code: 'ticket.restriction.unknown_type',
  system: 'ticket',
  severity: 'cosmetic',
  repair: 'confirm',
  entity: 'UserTicketRestriction',
  rowId: 5,
  params: { typeId: 'gone' },
};
const RATE: HealthFinding = {
  code: 'xp.config.rate_inverted',
  system: 'xp',
  severity: 'cosmetic',
  repair: 'confirm',
  entity: 'XPConfig',
  rowId: 9,
  field: 'xpPerMessageMin',
  params: { min: 30, max: 10 },
};
const UNKNOWN_TYPE: HealthFinding = {
  code: 'core.staff_role.unknown_type',
  system: 'core',
  severity: 'degraded',
  repair: 'manual',
  entity: 'StaffRole',
  rowId: 3,
  params: { type: 't' },
};

function reportOf(guildId: string, findings: HealthFinding[]): HealthReport {
  const systems: HealthReport['systems'] = {};
  for (const f of findings) {
    systems[f.system] ??= { status: 'warn', findings: [] };
    systems[f.system]!.findings.push(f);
  }
  return {
    guildId,
    botVersion: '3.17.0',
    checkedAt: '2026-10-07T12:00:00.000Z',
    deep: false,
    systems,
    counts: { auto: 0, confirm: 0, manual: 0 },
    notChecked: [],
  };
}

interface Options {
  userId?: string;
  admin?: boolean;
  deep?: boolean | null;
  guildIdOption?: string | null;
  /** The findings of each check run in turn; the last repeats. */
  checks?: HealthFinding[][];
  apply?: RepairDeps['applyRepairPlan'];
}

function setup(opts: Options = {}) {
  const guild = makeFakeGuild({ id: G });
  const other = { ...makeFakeGuild({ id: OTHER }), name: 'Other Server' } as unknown as Guild;
  const client = {
    guilds: {
      cache: new Map([
        [G, guild],
        [OTHER, other],
      ]),
    },
  };
  const checks = opts.checks ?? [[LOCALE, RESTRICTION, RATE, UNKNOWN_TYPE]];
  const runs: { guild: Guild; options: HealthRunOptions }[] = [];
  const applied: { guild: Guild; plan: RepairPlan; actor: RepairActor }[] = [];
  const deps: RepairDeps = {
    runHealthCheckWithContext: async (target: Guild, options: HealthRunOptions = {}) => {
      const findings = checks[Math.min(runs.length, checks.length - 1)];
      runs.push({ guild: target, options });
      const rows = {
        BotConfig: [{ guildId: target.id, locale: 'jp' }],
        UserTicketRestriction: [{ id: 5, guildId: target.id, typeId: 'gone' }],
        XPConfig: [{ id: 9, guildId: target.id, xpPerMessageMin: 30, xpPerMessageMax: 10 }],
      };
      // BotConfig rows are keyed by their guild.
      const own = findings.map(f => (f.entity === 'BotConfig' ? { ...f, rowId: target.id } : f));
      return { report: reportOf(target.id, own), ctx: makeCheckContext({ guild: target, rows }) };
    },
    applyRepairPlan:
      opts.apply ??
      (async (target, plan, actor): Promise<RepairResult> => {
        applied.push({ guild: target, plan, actor });
        return { results: plan.steps.map(step => ({ step, outcome: 'applied' })), counts: {} as never };
      }),
  };

  const collector = Object.assign(new EventEmitter(), { stop: () => collector.emit('end') });
  const collectorOptions: { filter?: (i: unknown) => boolean }[] = [];
  const message = {
    createMessageComponentCollector: (options: { filter?: (i: unknown) => boolean }) => {
      collectorOptions.push(options);
      return collector;
    },
  };
  const calls = { replies: [] as any[], defers: [] as any[], edits: [] as any[] };
  const userId = opts.userId ?? ADMIN;
  const interaction = {
    commandName: 'bot-health',
    user: { id: userId, tag: `user-${userId}` },
    guildId: G,
    guild,
    member: { permissions: new PermissionsBitField(opts.admin === false ? [] : ['Administrator']) },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    options: {
      getString: (name: string) => (name === 'guild-id' ? (opts.guildIdOption ?? null) : null),
      getBoolean: (name: string) => (name === 'deep' ? (opts.deep ?? null) : null),
      getSubcommand: () => 'repair',
    },
    async reply(payload: unknown) {
      calls.replies.push(payload);
      interaction.replied = true;
    },
    async deferReply(payload: unknown) {
      calls.defers.push(payload);
      interaction.deferred = true;
    },
    async editReply(payload: unknown) {
      calls.edits.push(payload);
      return message;
    },
  };
  const run = () => botHealthRepairHandler(client as never, interaction as never, deps);
  return { run, runs, applied, calls, collector, collectorOptions, interaction };
}

/** A click on the preview, recording what the handler sends back. */
function click(customId: string, opts: { values?: string[]; userId?: string; admin?: boolean } = {}) {
  const sent = { updates: [] as any[], replies: [] as any[], followUps: [] as any[], deferUpdates: 0 };
  const userId = opts.userId ?? ADMIN;
  const i = {
    customId,
    values: opts.values ?? [],
    user: { id: userId, tag: `user-${userId}` },
    guildId: G,
    guild: makeFakeGuild({ id: G }),
    member: { permissions: new PermissionsBitField(opts.admin === false ? [] : ['Administrator']) },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    isStringSelectMenu: () => customId === REPAIR_CID.select,
    async update(payload: unknown) {
      sent.updates.push(payload);
      i.replied = true;
    },
    async reply(payload: unknown) {
      sent.replies.push(payload);
      i.replied = true;
    },
    async followUp(payload: unknown) {
      sent.followUps.push(payload);
    },
    async deferUpdate() {
      sent.deferUpdates++;
    },
  };
  return { i, sent };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function press(t: ReturnType<typeof setup>, customId: string, opts: Parameters<typeof click>[1] = {}) {
  const c = click(customId, opts);
  t.collector.emit('collect', c.i);
  await settle();
  return c.sent;
}

const text = (payloads: any[]) => payloads.map(p => (typeof p === 'string' ? p : (p.content ?? ''))).join('\n');
const keysOf = (plan: RepairPlan) => plan.fixes.map(f => f.key).sort();
const lastEdit = (t: ReturnType<typeof setup>) => t.calls.edits.at(-1);

describe('access', () => {
  test('an admin gets the preview: automatic, to confirm, left for them', async () => {
    const t = setup();
    await t.run();
    expect(t.calls.defers).toHaveLength(1);
    const embed = t.calls.edits[0].embeds[0].toJSON();
    expect(embed.title).toBe('Repair preview');
    expect(embed.description).toContain('**Fixes to confirm (2)**');
    expect(embed.fields.map((f: { name: string }) => f.name)).toEqual(['Automatic fixes (1)', 'Left for you (1)']);
    expect(embed.fields[0].value).toBe('• Set the server language to English ×1');
    const select = t.calls.edits[0].components[0].toJSON().components[0];
    expect(select.options.map((o: { value: string }) => o.value).sort()).toEqual(
      [findingKey(RESTRICTION), findingKey(RATE)].sort(),
    );
  });

  test('a member without Administrator is refused and nothing runs', async () => {
    const t = setup({ userId: MEMBER, admin: false });
    await t.run();
    expect(t.runs).toEqual([]);
    expect(text(t.calls.replies)).toContain('Administrator');
  });

  test('the owner repairs another server: the title names it', async () => {
    const t = setup({ userId: OWNER, admin: false, guildIdOption: OTHER });
    await t.run();
    expect(t.runs.map(r => r.guild.id)).toEqual([OTHER]);
    expect(t.calls.edits[0].embeds[0].toJSON().title).toBe('Repair preview: Other Server');
  });

  test('guild-id is owner only: an admin gets an error and nothing runs', async () => {
    const t = setup({ guildIdOption: OTHER });
    await t.run();
    expect(t.runs).toEqual([]);
    expect(text(t.calls.replies)).toContain('Only the bot owner');
  });

  test('nothing to fix: the preview says so and no collector waits', async () => {
    const t = setup({ checks: [[UNKNOWN_TYPE]] });
    await t.run();
    expect(t.calls.edits[0].embeds[0].toJSON().description).toContain("There's nothing the repair can fix");
    expect(t.calls.edits[0].components).toEqual([]);
    expect(t.collectorOptions).toEqual([]);
  });
});

describe('rate limits (per guild, owner bypass)', () => {
  test('5 repairs an hour per server, even across admins; the 6th is refused', async () => {
    for (let n = 0; n < 5; n++) await setup({ userId: n % 2 ? ADMIN : ADMIN_2 }).run();
    const sixth = setup();
    await sixth.run();
    expect(sixth.runs).toEqual([]);
    expect(text(sixth.calls.replies)).toContain('5 times an hour');
  });

  test('a deep repair takes a repair slot and the deep check slot', async () => {
    const t = setup({ deep: true });
    await t.run();
    expect(t.runs[0].options).toEqual({ system: undefined, deep: true });
    expect(repairSlotsLeft()).toBe(4);
    expect(deepSlotsLeft()).toBe(0);
  });

  test('refused on the deep slot, the repair slot it took is given back', async () => {
    await setup({ deep: true }).run();
    const again = setup({ deep: true });
    await again.run();
    expect(again.runs).toEqual([]);
    expect(text(again.calls.replies)).toContain('every 10 minutes');
    expect(repairSlotsLeft()).toBe(4);
  });

  test('a check that fails gives back both slots and says the run did not count', async () => {
    const t = setup({ deep: true });
    t.interaction.editReply = async (payload: unknown) => {
      t.calls.edits.push(payload);
      return {} as never;
    };
    await botHealthRepairHandler({ guilds: { cache: new Map() } } as never, t.interaction as never, {
      runHealthCheckWithContext: async () => {
        throw new Error('boom');
      },
      applyRepairPlan: async () => {
        throw new Error('not reached');
      },
    });
    expect(text(t.calls.edits)).toContain("couldn't be built");
    expect(text(t.calls.edits)).toContain("doesn't count toward the rate limit");
    expect(repairSlotsLeft()).toBe(5);
    expect(deepSlotsLeft()).toBe(1);
  });

  test('the bot owner is never rate limited', async () => {
    for (let n = 0; n < 7; n++) {
      const t = setup({ userId: OWNER, deep: true });
      await t.run();
      expect(t.runs).toHaveLength(1);
    }
  });
});

describe('preview collector', () => {
  test("only the invoker's clicks are collected", async () => {
    const t = setup();
    await t.run();
    const [{ filter }] = t.collectorOptions;
    expect(filter?.({ user: { id: ADMIN } })).toBe(true);
    expect(filter?.({ user: { id: ADMIN_2 } })).toBe(false);
  });

  test('apply automatic sends only the automatic keys, then re-checks without a slot and shows the results', async () => {
    const t = setup({
      checks: [
        [LOCALE, RESTRICTION, RATE, UNKNOWN_TYPE],
        [RESTRICTION, RATE, UNKNOWN_TYPE],
      ],
    });
    await t.run();
    const sent = await press(t, REPAIR_CID.auto);

    // The click greys the preview out at once.
    for (const row of sent.updates[0].components) {
      for (const component of row.toJSON().components) expect(component.disabled).toBe(true);
    }
    expect(t.applied).toHaveLength(1);
    expect(keysOf(t.applied[0].plan)).toEqual([findingKey(LOCALE)]);
    expect(t.applied[0].plan.fixes.every(f => f.repair === 'auto')).toBe(true);
    expect(t.applied[0].actor).toEqual({ userId: ADMIN, source: 'command', checkedAt: '2026-10-07T12:00:00.000Z' });
    expect(t.runs).toHaveLength(2);
    expect(repairSlotsLeft()).toBe(4);

    const [results, summary] = lastEdit(t).embeds.map((e: { toJSON(): any }) => e.toJSON());
    expect(results.description).toContain('✅ Fixed: 1');
    expect(summary.footer.text).toBe('/bot-health repair: 0 automatic, 2 to confirm, 1 to fix yourself');
    const again = lastEdit(t).components[0].toJSON().components[0];
    expect(again.custom_id).toBe(REPAIR_CID.again);

    // "Preview remaining fixes" shows the re-check's plan.
    const preview = await press(t, REPAIR_CID.again);
    const embed = preview.updates[0].embeds[0].toJSON();
    expect(embed.fields.map((f: { name: string }) => f.name)).toEqual(['Left for you (1)']);
    expect(embed.description).toContain('**Fixes to confirm (2)**');
  });

  test('apply selected sends exactly the picked keys', async () => {
    const t = setup();
    await t.run();
    const picked = await press(t, REPAIR_CID.select, { values: [findingKey(RATE)] });
    const buttons = picked.updates[0].components[1].toJSON().components;
    expect(buttons.find((b: { custom_id: string }) => b.custom_id === REPAIR_CID.apply)).toMatchObject({
      label: 'Apply selected (1)',
      disabled: false,
    });
    await press(t, REPAIR_CID.apply);
    expect(t.applied).toHaveLength(1);
    expect(keysOf(t.applied[0].plan)).toEqual([findingKey(RATE)]);
    expect(t.applied[0].plan.steps).toHaveLength(1);
    expect(t.applied[0].plan.steps[0].set).toEqual({ xpPerMessageMin: 10, xpPerMessageMax: 30 });
  });

  test('a value that is not a fix on this page is ignored', async () => {
    const t = setup();
    await t.run();
    await press(t, REPAIR_CID.select, { values: [findingKey(LOCALE), 'not-a-key'] });
    await press(t, REPAIR_CID.apply);
    expect(t.applied).toEqual([]);
  });

  test('an admin who lost Administrator since the command ran is refused; nothing is applied', async () => {
    const t = setup();
    await t.run();
    const sent = await press(t, REPAIR_CID.auto, { admin: false });
    expect(t.applied).toEqual([]);
    expect(text(sent.replies)).toContain('Administrator');
    expect(lastEdit(t)).toEqual({ components: [] });
  });

  test('the owner applies without Administrator, on the server they named', async () => {
    const t = setup({ userId: OWNER, admin: false, guildIdOption: OTHER });
    await t.run();
    await press(t, REPAIR_CID.auto, { userId: OWNER, admin: false });
    expect(t.applied.map(a => a.guild.id)).toEqual([OTHER]);
    expect(t.applied[0].plan.steps.every(step => step.where.guildId === OTHER)).toBe(true);
  });

  test('another repair holding the lock: "already running", and the preview comes back', async () => {
    const t = setup({
      apply: async () => {
        throw new RepairBusyError(G);
      },
    });
    await t.run();
    const sent = await press(t, REPAIR_CID.auto);
    expect(text(sent.followUps)).toContain('Another repair is running on this server');
    expect(t.runs).toHaveLength(1);
    const buttons = lastEdit(t).components[1].toJSON().components;
    expect(buttons.find((b: { custom_id: string }) => b.custom_id === REPAIR_CID.auto).disabled).toBe(false);
  });

  test('a click while a repair runs is acknowledged and ignored', async () => {
    let release: () => void = () => {};
    const t = setup({
      apply: (_guild, plan) =>
        new Promise(resolve => {
          release = () =>
            resolve({ results: plan.steps.map(step => ({ step, outcome: 'applied' })), counts: {} as never });
        }),
    });
    await t.run();
    const first = click(REPAIR_CID.auto);
    t.collector.emit('collect', first.i);
    await settle();
    const second = await press(t, REPAIR_CID.auto);
    expect(second.deferUpdates).toBe(1);
    expect(second.updates).toEqual([]);
    release();
    await settle();
    expect(lastEdit(t).embeds[0].toJSON().title).toBe('Repair results');
  });

  test('a repair that throws reports it with a bug link and closes the preview', async () => {
    const t = setup({
      apply: async () => {
        throw new Error('db down');
      },
    });
    await t.run();
    const sent = await press(t, REPAIR_CID.auto);
    expect(text(sent.followUps)).toContain("The repair couldn't finish");
    expect(text(sent.followUps)).toContain('support server');
    expect(lastEdit(t)).toEqual({ components: [] });
  });

  test('cancel changes nothing and removes the buttons', async () => {
    const t = setup();
    await t.run();
    const sent = await press(t, REPAIR_CID.cancel);
    expect(sent.updates[0]).toEqual({ content: 'Repair cancelled. Nothing was changed.', embeds: [], components: [] });
    expect(t.applied).toEqual([]);
    expect(lastEdit(t)).toEqual({ components: [] });
  });

  test('when the collector ends the components are removed', async () => {
    const t = setup();
    await t.run();
    t.collector.emit('end');
    await settle();
    expect(lastEdit(t)).toEqual({ components: [] });
  });
});
