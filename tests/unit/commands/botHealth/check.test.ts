/**
 * `/bot-health check` handler: who may run it (admins, the bot owner, nobody
 * else), the owner-only `guild-id` option, per-guild rate limits with the
 * owner bypass, and the collector (details view, Export JSON).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { type Guild, PermissionsBitField } from 'discord.js';
import { botHealthCheckHandler } from '../../../../src/commands/handlers/botHealth/check';
import { HEALTH_CID } from '../../../../src/commands/handlers/botHealth/render';
import type { HealthRunOptions } from '../../../../src/utils/health/runner';
import type { HealthReport } from '../../../../src/utils/health/types';
import { rateLimiter } from '../../../../src/utils/security/rateLimiter';
import { makeFakeGuild } from '../../../helpers/fakeGuild';

const G = '100000000000000001';
const OTHER = '100000000000000002';
const OWNER = '400000000000000001';
const ADMIN = '400000000000000002';
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

function sampleReport(guildId: string): HealthReport {
  return {
    guildId,
    botVersion: '3.16.25',
    checkedAt: '2026-10-06T12:00:00.000Z',
    deep: false,
    systems: {
      core: {
        status: 'warn',
        findings: [
          {
            code: 'core.locale.unsupported',
            system: 'core',
            severity: 'cosmetic',
            repair: 'auto',
            entity: 'BotConfig',
            params: { locale: 'jp' },
          },
        ],
      },
    },
    counts: { auto: 1, confirm: 0, manual: 0 },
    notChecked: [],
  };
}

interface Options {
  userId?: string;
  admin?: boolean;
  system?: string | null;
  deep?: boolean | null;
  guildIdOption?: string | null;
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
  const runs: { guild: Guild; options: HealthRunOptions }[] = [];
  const deps = {
    runHealthCheck: async (target: Guild, options: HealthRunOptions = {}) => {
      runs.push({ guild: target, options });
      return sampleReport(target.id);
    },
  };

  const collector = new EventEmitter();
  const message = { createMessageComponentCollector: () => collector };
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
      getString: (name: string) =>
        name === 'system' ? (opts.system ?? null) : name === 'guild-id' ? (opts.guildIdOption ?? null) : null,
      getBoolean: (name: string) => (name === 'deep' ? (opts.deep ?? null) : null),
      getSubcommand: () => 'check',
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
  const run = () => botHealthCheckHandler(client as never, interaction as never, deps);
  return { run, runs, calls, collector, interaction };
}

const replyText = (calls: { replies: any[]; edits: any[] }) =>
  [...calls.replies, ...calls.edits].map(p => (typeof p === 'string' ? p : (p.content ?? ''))).join('\n');

describe('access', () => {
  test('an admin can run it: deferred ephemerally, then the summary', async () => {
    const t = setup();
    await t.run();
    expect(t.runs).toEqual([{ guild: t.interaction.guild as never, options: { system: undefined, deep: false } }]);
    expect(t.calls.defers).toHaveLength(1);
    expect(t.calls.edits[0].embeds[0].toJSON().title).toBe('Server health');
  });

  test('a member without Administrator is refused and nothing runs', async () => {
    const t = setup({ userId: MEMBER, admin: false });
    await t.run();
    expect(t.runs).toEqual([]);
    expect(replyText(t.calls)).toContain('Administrator');
  });

  test('the bot owner can run it without Administrator', async () => {
    const t = setup({ userId: OWNER, admin: false });
    await t.run();
    expect(t.runs).toHaveLength(1);
  });

  test('system and deep options reach the engine; "all" means every system', async () => {
    const one = setup({ system: 'ticket', deep: true });
    await one.run();
    expect(one.runs[0].options).toEqual({ system: 'ticket', deep: true });
    (rateLimiter as unknown as { limits: Map<string, unknown> }).limits.clear();
    const all = setup({ system: 'all' });
    await all.run();
    expect(all.runs[0].options).toEqual({ system: undefined, deep: false });
  });

  test('an engine failure is reported, not left on "thinking"', async () => {
    const t = setup();
    const failing = async () => {
      throw new Error('boom');
    };
    await botHealthCheckHandler({ guilds: { cache: new Map() } } as never, t.interaction as never, {
      runHealthCheck: failing,
    });
    expect(replyText(t.calls)).toContain("couldn't finish");
  });
});

describe('guild-id (owner only)', () => {
  test('the owner checks another server; the title names it', async () => {
    const t = setup({ userId: OWNER, admin: false, guildIdOption: OTHER });
    await t.run();
    expect(t.runs.map(r => r.guild.id)).toEqual([OTHER]);
    expect(t.calls.edits[0].embeds[0].toJSON().title).toBe('Server health: Other Server');
  });

  test('an admin who is not the owner gets an error and nothing runs', async () => {
    const t = setup({ guildIdOption: OTHER });
    await t.run();
    expect(t.runs).toEqual([]);
    expect(replyText(t.calls)).toContain('Only the bot owner');
    expect(t.calls.defers).toEqual([]);
  });

  test('the owner gets an error for an invalid id or a server the bot is not in', async () => {
    const invalid = setup({ userId: OWNER, guildIdOption: 'not-a-snowflake' });
    await invalid.run();
    expect(replyText(invalid.calls)).toContain("isn't a valid server ID");
    const unknown = setup({ userId: OWNER, guildIdOption: '100000000000000099' });
    await unknown.run();
    expect(replyText(unknown.calls)).toContain("isn't in a server with the ID `100000000000000099`");
    expect([...invalid.runs, ...unknown.runs]).toEqual([]);
  });
});

describe('rate limits (per guild, owner bypass)', () => {
  test('a second check within a minute is refused, even by another admin', async () => {
    const first = setup();
    await first.run();
    const second = setup({ userId: '400000000000000009' });
    await second.run();
    expect(first.runs).toHaveLength(1);
    expect(second.runs).toEqual([]);
    expect(replyText(second.calls)).toContain('once a minute');
  });

  test('deep checks have their own 10-minute limit', async () => {
    const quick = setup();
    await quick.run();
    const deep = setup({ deep: true });
    await deep.run();
    expect(deep.runs).toHaveLength(1);
    const again = setup({ deep: true });
    await again.run();
    expect(again.runs).toEqual([]);
    expect(replyText(again.calls)).toContain('every 10 minutes');
  });

  test('the bot owner is never rate limited', async () => {
    for (let i = 0; i < 3; i++) {
      const t = setup({ userId: OWNER, deep: true });
      await t.run();
      expect(t.runs).toHaveLength(1);
    }
  });
});

describe('collector', () => {
  test('picking a system shows its findings; Export JSON attaches the report', async () => {
    const t = setup();
    await t.run();

    const updates: any[] = [];
    t.collector.emit('collect', {
      customId: HEALTH_CID.system,
      values: ['core'],
      user: { id: ADMIN },
      isStringSelectMenu: () => true,
      update: async (payload: unknown) => {
        updates.push(payload);
      },
    });
    const exports: any[] = [];
    t.collector.emit('collect', {
      customId: HEALTH_CID.export,
      user: { id: ADMIN },
      isStringSelectMenu: () => false,
      reply: async (payload: unknown) => {
        exports.push(payload);
      },
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(updates[0].embeds[0].toJSON().fields[0].value).toContain('`jp`');
    expect(exports[0].files[0].name).toStartWith(`bot-health-${G}-`);
    expect(exports[0].flags).toBeDefined();
  });

  test('when the collector ends the components are removed', async () => {
    const t = setup();
    await t.run();
    t.collector.emit('end');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(t.calls.edits.at(-1)).toEqual({ components: [] });
  });
});
