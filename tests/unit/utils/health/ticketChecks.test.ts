/**
 * Ticket health checks (types, restrictions, open tickets), the open-row loader
 * filter, and how the ticket system reads as configured. Panel and archive
 * checks are in panelChecks.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { Not } from 'typeorm';
import { type LoadedRows, repoRowLoader } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runCheck, runHealthCheck } from '../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../src/utils/health/types';
import { FAKE_GUILD_ID, type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeFakeRepo } from '../../../helpers/fakeRepo';
import { makeCheckContext } from '../../../helpers/healthContext';

const G = FAKE_GUILD_ID;
const PANEL = '300000000000000001';
const TICKET_CHANNEL = '300000000000000002';
const GONE = '300000000000000666';
const EMOJI = '500000000000000001';
const OTHER_EMOJI = '500000000000000002';

type EmojiFetch = () => Promise<Map<string, unknown>>;
/** `guild.client`: other servers' emoji caches and the bot's own (application) emoji. */
type FakeClient = { guilds: { cache: Map<string, unknown> }; application: { emojis: { fetch: EmojiFetch } } | null };

async function run(
  checkId: string,
  rows: LoadedRows,
  opts: { guild?: FakeGuildInit; deep?: boolean; emojis?: EmojiFetch; client?: FakeClient } = {},
): Promise<HealthFinding[]> {
  const check = getChecks().find(c => c.id === checkId);
  if (!check) throw new Error(`no check ${checkId}`);
  const guild = makeFakeGuild({
    botPermissions: [PermissionFlagsBits.Administrator],
    channels: [
      { id: PANEL, type: ChannelType.GuildText },
      { id: TICKET_CHANNEL, type: ChannelType.GuildText },
    ],
    ...opts.guild,
  });
  if (opts.emojis) Object.assign(guild, { emojis: { fetch: opts.emojis } });
  if (opts.client) Object.assign(guild, { client: opts.client });
  return (await runCheck(check, makeCheckContext({ guild, rows, deep: opts.deep }))).findings;
}

describe('registry', () => {
  test('registers the ticket checks', () => {
    expect(getChecks('ticket').map(c => c.id)).toEqual([
      'ticket.panel',
      'ticket.archive',
      'ticket.type',
      'ticket.restriction',
      'ticket.open',
    ]);
  });
});

let nextId = 1;
function type(o: Record<string, unknown> = {}) {
  const id = nextId++;
  return {
    id,
    guildId: G,
    typeId: `type_${id}`,
    displayName: `Type ${id}`,
    emoji: '🐛',
    embedColor: '#0099ff',
    isActive: true,
    isDefault: false,
    sortOrder: id,
    customFields: null,
    ...o,
  };
}
const field = (o: Record<string, unknown> = {}) => ({
  id: 'name',
  label: 'Your name',
  style: 'short',
  required: true,
  ...o,
});
const config = { id: 1, guildId: G, channelId: PANEL };

describe('ticket.type', () => {
  const id = 'ticket.type';
  const rows = (types: unknown[], configs: unknown[] = [config]): LoadedRows => ({
    CustomTicketType: types,
    TicketConfig: configs,
  });

  test('pass: valid active and inactive types', async () => {
    const fields = [field(), field({ id: 'details', style: 'paragraph', minLength: 10, maxLength: 4000 })];
    const types = [type({ isDefault: true, customFields: fields }), type({ isActive: false, emoji: null })];
    expect(await run(id, rows(types))).toEqual([]);
  });

  test('more than 25 active types: the menu falls back to the 5 built-in types (degraded)', async () => {
    expect(await run(id, rows(Array.from({ length: 25 }, () => type())))).toEqual([]);
    const findings = await run(id, rows(Array.from({ length: 26 }, () => type())));
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'ticket.type.too_many_active',
        severity: 'degraded',
        repair: 'manual',
        params: { count: 26 },
      }),
    ]);
  });

  test('no active type: block (nobody can open a ticket) only while the panel is posted', async () => {
    const inactive = [type({ isActive: false })];
    const [f] = await run(id, rows(inactive));
    expect(f).toMatchObject({ code: 'ticket.type.none_active', severity: 'block', repair: 'manual' });
    expect(await run(id, rows(inactive, [{ ...config, channelId: '' }]))).toEqual([]);
    expect(await run(id, rows(inactive, []))).toEqual([]);
  });

  test('two defaults: the later one in sort order is the extra', async () => {
    const first = type({ isDefault: true, sortOrder: 1 });
    const second = type({ isDefault: true, sortOrder: 2 });
    const findings = await run(id, rows([second, first]));
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'ticket.type.multiple_defaults',
        severity: 'cosmetic',
        repair: 'auto',
        rowId: second.id,
        params: { typeId: second.typeId, keptTypeId: first.typeId },
      }),
    ]);
  });

  test('color must be #rrggbb', async () => {
    const bad = type({ embedColor: 'blue' });
    const [f] = await run(id, rows([bad]));
    expect(f).toMatchObject({ code: 'ticket.type.color_invalid', severity: 'cosmetic', field: 'embedColor' });
    expect(f.params).toMatchObject({ color: 'blue', typeId: bad.typeId });
  });

  test('a form title over 45 characters blocks that type (cosmetic while inactive)', async () => {
    // "🐛 " is 3 UTF-16 units, so 42 characters of name is exactly 45.
    expect(await run(id, rows([type({ displayName: 'x'.repeat(42) })]))).toEqual([]);
    const [f] = await run(id, rows([type({ displayName: 'x'.repeat(43) })]));
    expect(f).toMatchObject({ code: 'ticket.type.title_too_long', severity: 'block', params: { length: 46 } });
    const inactive = await run(id, rows([type(), type({ displayName: 'x'.repeat(43), isActive: false })]));
    expect(inactive).toEqual([expect.objectContaining({ code: 'ticket.type.title_too_long', severity: 'cosmetic' })]);
  });

  test('emoji: unicode (with or without U+FE0F, flags, skin tones, ZWJ) and custom forms pass', async () => {
    const ok = ['⚖️', '❤', '🇺🇸', '👍🏽', '👨‍👩‍👧', '1️⃣', `<:bug:${EMOJI}>`, `<a:spin:${EMOJI}>`, EMOJI];
    expect(await run(id, rows(ok.map(emoji => type({ emoji }))))).toEqual([]);
  });

  test('emoji Discord rejects: degraded while active (built-in fallback), cosmetic while inactive', async () => {
    for (const emoji of ['abc', ':bug:', '😀😀', '<:bug:12>']) {
      const [f] = await run(id, rows([type({ emoji })]));
      expect(f).toMatchObject({ code: 'ticket.type.emoji_invalid', severity: 'degraded', repair: 'confirm' });
      expect(f.params.emoji).toBe(emoji);
    }
    const [inactive] = await run(id, rows([type(), type({ emoji: 'abc', isActive: false })]));
    expect(inactive).toMatchObject({ code: 'ticket.type.emoji_invalid', severity: 'cosmetic' });
  });

  test('deep: custom emoji not on the server is cosmetic and manual; one listing per check', async () => {
    let calls = 0;
    const emojis: EmojiFetch = async () => {
      calls++;
      return new Map([[EMOJI, {}]]);
    };
    const types = [
      type({ emoji: `<:bug:${EMOJI}>` }),
      type({ emoji: `<:gone:${OTHER_EMOJI}>` }),
      type({ emoji: OTHER_EMOJI }),
    ];
    const findings = await run(id, rows(types), { deep: true, emojis });
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'ticket.type.emoji_missing',
        severity: 'cosmetic',
        repair: 'manual',
        refId: OTHER_EMOJI,
        rowId: types[1].id,
      }),
      expect.objectContaining({ code: 'ticket.type.emoji_missing', rowId: types[2].id }),
    ]);
    expect(calls).toBe(1);
  });

  describe('deep: emoji the bot can use from elsewhere are not flagged', () => {
    const gone = [type({ emoji: `<:gone:${OTHER_EMOJI}>` })];
    const serverEmojis: EmojiFetch = async () => new Map();
    const fakeGuildWith = (guildId: string, emojiIds: string[]) => ({
      id: guildId,
      emojis: { cache: new Map(emojiIds.map(e => [e, {}])) },
    });
    const client = (o: Partial<FakeClient> = {}): FakeClient => ({
      guilds: { cache: new Map() },
      application: { emojis: { fetch: async () => new Map() } },
      ...o,
    });

    test("the bot's own (application) emoji, listed once per check", async () => {
      let calls = 0;
      const application = {
        emojis: {
          fetch: async () => {
            calls++;
            return new Map([[OTHER_EMOJI, {}]]);
          },
        },
      };
      const both = [...gone, type({ emoji: `<a:spin:${OTHER_EMOJI}>` })];
      expect(await run(id, rows(both), { deep: true, emojis: serverEmojis, client: client({ application }) })).toEqual(
        [],
      );
      expect(calls).toBe(1);
    });

    test("another server the bot is in (from the cache); this server's cache doesn't count", async () => {
      const elsewhere = new Map([['900000000000000001', fakeGuildWith('900000000000000001', [OTHER_EMOJI])]]);
      expect(
        await run(id, rows(gone), {
          deep: true,
          emojis: serverEmojis,
          client: client({ guilds: { cache: elsewhere } }),
        }),
      ).toEqual([]);
      // This server's own cache can be stale, so only the fresh listing counts for it.
      const stale = new Map([[G, fakeGuildWith(G, [OTHER_EMOJI])]]);
      const [f] = await run(id, rows(gone), {
        deep: true,
        emojis: serverEmojis,
        client: client({ guilds: { cache: stale } }),
      });
      expect(f).toMatchObject({ code: 'ticket.type.emoji_missing', severity: 'cosmetic', repair: 'manual' });
    });

    test('a failed listing of the bot emoji is not proof; no application still reports', async () => {
      const failing = { emojis: { fetch: () => Promise.reject({ status: 503 }) } };
      const opts = { deep: true, emojis: serverEmojis };
      expect(await run(id, rows(gone), { ...opts, client: client({ application: failing }) })).toEqual([]);
      const [f] = await run(id, rows(gone), { ...opts, client: client({ application: null }) });
      expect(f).toMatchObject({ code: 'ticket.type.emoji_missing', severity: 'cosmetic', repair: 'manual' });
    });
  });

  test('custom emoji are not resolved without deep, or when the listing fails', async () => {
    let calls = 0;
    const failing: EmojiFetch = () => {
      calls++;
      return Promise.reject({ status: 503 });
    };
    const types = [type({ emoji: `<:gone:${OTHER_EMOJI}>` })];
    expect(await run(id, rows(types), { emojis: failing })).toEqual([]);
    expect(calls).toBe(0);
    expect(await run(id, rows(types), { deep: true, emojis: failing })).toEqual([]);
    expect(calls).toBe(1);
  });

  test('more than 5 form questions: the form shows the first 5, so degraded (cosmetic while inactive)', async () => {
    const fields = Array.from({ length: 6 }, (_, i) => field({ id: `q${i}` }));
    const findings = await run(id, rows([type({ customFields: fields })]));
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'ticket.type.too_many_fields',
        severity: 'degraded',
        repair: 'confirm',
        field: 'customFields',
        params: expect.anything(),
      }),
    ]);
    expect(findings[0].params.count).toBe(6);
    const [inactive] = await run(id, rows([type(), type({ customFields: fields, isActive: false })]));
    expect(inactive).toMatchObject({ code: 'ticket.type.too_many_fields', severity: 'cosmetic' });
  });

  test('questions past the 5th are never shown, so only the first 5 are checked', async () => {
    const shown = Array.from({ length: 5 }, (_, i) => field({ id: `q${i}` }));
    const dropped = [field({ id: 'q0', label: '' }), field({ id: '', maxLength: 5000 })];
    const findings = await run(id, rows([type({ customFields: [...shown, ...dropped] })]));
    expect(findings.map(f => f.code)).toEqual(['ticket.type.too_many_fields']);
    // A problem in the first 5 still breaks the form.
    const broken = [field({ id: 'q0', label: '' }), ...shown.slice(1), field({ id: 'q5' })];
    const both = await run(id, rows([type({ customFields: broken })]));
    expect(both.map(f => [f.code, f.severity])).toEqual([
      ['ticket.type.too_many_fields', 'degraded'],
      ['ticket.type.field_label', 'block'],
    ]);
  });

  test.each([
    ['field_id', [field({ id: '' })]],
    ['field_id', [field({ id: 'x'.repeat(101) })]],
    ['field_id', [field(), field({ label: 'Again' })]],
    ['field_label', [field({ label: '' })]],
    ['field_label', [field({ label: 'x'.repeat(46) })]],
    ['field_placeholder', [field({ placeholder: 'x'.repeat(101) })]],
    ['field_length', [field({ minLength: 50, maxLength: 10 })]],
    ['field_length', [field({ maxLength: 5000 })]],
    ['field_length', [field({ minLength: -1 })]],
    ['field_length', [field({ maxLength: '100' })]],
  ])('form question problem: %s', async (name, fields) => {
    const findings = await run(id, rows([type({ customFields: fields })]));
    expect(findings).toEqual([
      expect.objectContaining({ code: `ticket.type.${name}`, severity: 'block', repair: 'confirm' }),
    ]);
  });

  test('pass: limits at the edges, and zero limits the modal ignores', async () => {
    const fields = [
      field({ id: 'x'.repeat(100), label: 'x'.repeat(45), placeholder: 'x'.repeat(100) }),
      field({ id: 'b', minLength: 0, maxLength: 0 }),
      field({ id: 'c', minLength: 4000, maxLength: 4000 }),
    ];
    expect(await run(id, rows([type({ customFields: fields })]))).toEqual([]);
  });
});

describe('ticket.restriction', () => {
  const id = 'ticket.restriction';
  const restriction = (typeId: string) => ({ id: 7, guildId: G, userId: '600000000000000001', typeId });

  test('pass: builtin ids and custom types (active or not)', async () => {
    const custom = type({ isActive: false });
    for (const typeId of ['ban_appeal', custom.typeId]) {
      expect(await run(id, { UserTicketRestriction: [restriction(typeId)], CustomTicketType: [custom] })).toEqual([]);
    }
  });

  test('fail: restriction for a type that no longer exists', async () => {
    const [f] = await run(id, { UserTicketRestriction: [restriction('old_type')], CustomTicketType: [] });
    expect(f).toMatchObject({
      code: 'ticket.restriction.unknown_type',
      severity: 'cosmetic',
      repair: 'confirm',
      entity: 'UserTicketRestriction',
      rowId: 7,
      params: { typeId: 'old_type', userId: '600000000000000001' },
    });
  });
});

describe('ticket.open', () => {
  const id = 'ticket.open';
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const ticket = (o: Record<string, unknown> = {}) => ({
    id: 42,
    guildId: G,
    channelId: TICKET_CHANNEL,
    status: 'opened',
    lastActivityAt: minutesAgo(60),
    ...o,
  });

  test('pass: open ticket with its channel; closed tickets are ignored', async () => {
    expect(await run(id, { Ticket: [ticket(), ticket({ status: 'closed', channelId: GONE })] })).toEqual([]);
  });

  test('fail: open ticket whose channel was deleted', async () => {
    const [f] = await run(id, { Ticket: [ticket({ channelId: GONE, status: 'in-progress' })] });
    expect(f).toMatchObject({
      code: 'ticket.open.channel_missing',
      severity: 'degraded',
      repair: 'confirm',
      entity: 'Ticket',
      rowId: 42,
      refId: GONE,
      params: { ticketId: 42, channelId: GONE },
    });
  });

  test('pass: a deleted-looking channel in an unavailable guild is not proof', async () => {
    expect(await run(id, { Ticket: [ticket({ channelId: GONE })] }, { guild: { available: false } })).toEqual([]);
  });

  test('created without a channel: in flight for 10 minutes, failed after', async () => {
    expect(
      await run(id, { Ticket: [ticket({ status: 'created', channelId: null, lastActivityAt: minutesAgo(1) })] }),
    ).toEqual([]);
    const [f] = await run(id, {
      Ticket: [ticket({ status: 'created', channelId: null, lastActivityAt: minutesAgo(11) })],
    });
    expect(f).toMatchObject({ code: 'ticket.open.creation_failed', severity: 'degraded', repair: 'confirm' });
  });
});

describe('row loading', () => {
  test('tickets and applications load only open rows, still scoped to the guild', async () => {
    const repo = makeFakeRepo([]);
    const loader = repoRowLoader(() => repo);
    await loader('Ticket', G);
    await loader('Application', G);
    await loader('TicketConfig', G);
    expect(repo.findCalls).toEqual([
      { where: { status: Not('closed'), guildId: G } },
      { where: { status: Not('closed'), guildId: G } },
      { where: { guildId: G } },
    ]);
  });
});

describe('ticket system status', () => {
  const report = async (rows: LoadedRows) => {
    const guild = makeFakeGuild({
      botPermissions: [PermissionFlagsBits.Administrator],
      channels: [{ id: TICKET_CHANNEL, type: ChannelType.GuildText }],
    });
    const loadRows = async (entity: string) => rows[entity as keyof LoadedRows] ?? [];
    return (await runHealthCheck(guild, { system: 'ticket' }, { loadRows })).systems.ticket;
  };

  test('not configured without a TicketConfig, even with seeded types', async () => {
    expect(await report({ CustomTicketType: [type()] })).toEqual({ status: 'not_configured', findings: [] });
  });

  test('a leftover open ticket still shows up on an unconfigured server', async () => {
    const leftover = { id: 9, guildId: G, channelId: GONE, status: 'opened', lastActivityAt: new Date() };
    expect((await report({ Ticket: [leftover] }))?.status).toBe('warn');
  });

  test('a config row makes the system configured', async () => {
    const rows = { TicketConfig: [{ id: 1, guildId: G, channelId: '', messageId: '', categoryId: null }] };
    expect(await report(rows)).toEqual({ status: 'ok', findings: [] });
  });
});
