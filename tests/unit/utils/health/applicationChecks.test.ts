/**
 * Application health checks (positions, open applications) and how the
 * application system reads as configured. Panel and archive checks are in
 * panelChecks.test.ts; the emoji and form-question rules are covered in depth
 * by ticketChecks.test.ts (same helpers).
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { LoadedRows } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runCheck, runHealthCheck } from '../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../src/utils/health/types';
import { FAKE_GUILD_ID, type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

const G = FAKE_GUILD_ID;
const PANEL = '300000000000000001';
const APP_CHANNEL = '300000000000000002';
const GONE = '300000000000000666';
const EMOJI = '500000000000000001';

async function run(
  checkId: string,
  rows: LoadedRows,
  opts: { guild?: FakeGuildInit; deep?: boolean; emojis?: () => Promise<Map<string, unknown>> } = {},
): Promise<HealthFinding[]> {
  const check = getChecks().find(c => c.id === checkId);
  if (!check) throw new Error(`no check ${checkId}`);
  const guild = makeFakeGuild({
    botPermissions: [PermissionFlagsBits.Administrator],
    channels: [
      { id: PANEL, type: ChannelType.GuildText },
      { id: APP_CHANNEL, type: ChannelType.GuildText },
    ],
    ...opts.guild,
  });
  if (opts.emojis) Object.assign(guild, { emojis: { fetch: opts.emojis } });
  return (await runCheck(check, makeCheckContext({ guild, rows, deep: opts.deep }))).findings;
}

const codes = (findings: HealthFinding[]) => findings.map(f => f.code);

test('registers the application checks', () => {
  expect(getChecks('application').map(c => c.id)).toEqual([
    'application.panel',
    'application.archive',
    'application.position',
    'application.open',
  ]);
});

let nextId = 1;
function position(o: Record<string, unknown> = {}) {
  const id = nextId++;
  return { id, guildId: G, title: `Position ${id}`, emoji: '📝', isActive: true, customFields: null, ...o };
}
const config = { id: 1, guildId: G, channelId: PANEL };

describe('application.position', () => {
  const id = 'application.position';
  const rows = (positions: unknown[], configs: unknown[] = [config]): LoadedRows => ({
    Position: positions,
    ApplicationConfig: configs,
  });

  test('pass: valid positions, including a long title (the modal truncates it)', async () => {
    const fields = [{ id: 'age', label: 'How old are you?', style: 'short', required: true, maxLength: 3 }];
    const positions = [position({ title: 'x'.repeat(80), customFields: fields }), position({ isActive: false })];
    expect(await run(id, rows(positions))).toEqual([]);
  });

  test('more than 25 open positions overflow the panel buttons', async () => {
    expect(await run(id, rows(Array.from({ length: 25 }, () => position())))).toEqual([]);
    const [f] = await run(id, rows(Array.from({ length: 26 }, () => position())));
    expect(f).toMatchObject({ code: 'application.position.too_many_active', severity: 'block', params: { count: 26 } });
  });

  test('no open position is not a finding: recruiting is closed and the panel says so', async () => {
    expect(await run(id, rows([position({ isActive: false })]))).toEqual([]);
    expect(await run(id, rows([]))).toEqual([]);
  });

  test('invalid emoji blocks an open position, and is cosmetic on a closed one', async () => {
    const findings = await run(id, rows([position({ emoji: 'apply' }), position({ emoji: 'x', isActive: false })]));
    expect(findings.map(f => [f.code, f.severity])).toEqual([
      ['application.position.emoji_invalid', 'block'],
      ['application.position.emoji_invalid', 'cosmetic'],
    ]);
    expect(findings[0]).toMatchObject({ entity: 'Position', field: 'emoji', params: { emoji: 'apply' } });
  });

  test('deep: custom emoji gone from the server', async () => {
    const emojis = async () => new Map<string, unknown>();
    const custom = position({ emoji: `<:apply:${EMOJI}>` });
    expect(await run(id, rows([custom]))).toEqual([]);
    const [f] = await run(id, rows([custom]), { deep: true, emojis });
    expect(f).toMatchObject({
      code: 'application.position.emoji_missing',
      refId: EMOJI,
      severity: 'cosmetic',
      repair: 'manual',
    });
  });

  test('more than 5 form questions block an open position (apply.ts adds them all)', async () => {
    const fields = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      label: `Q${i}`,
      style: 'short',
      required: true,
    }));
    fields[5].label = '';
    const findings = await run(id, rows([position({ customFields: fields })]));
    expect(findings.map(f => [f.code, f.severity])).toEqual([
      ['application.position.too_many_fields', 'block'],
      ['application.position.field_label', 'block'],
    ]);
  });

  test('form questions: a label over 45 characters breaks the form', async () => {
    const fields = [{ id: 'why', label: 'x'.repeat(46), style: 'paragraph', required: true }];
    const [f] = await run(id, rows([position({ customFields: fields })]));
    expect(f).toMatchObject({
      code: 'application.position.field_label',
      severity: 'block',
      field: 'customFields',
      params: { input: 1 },
    });
  });
});

describe('application.open', () => {
  const id = 'application.open';
  const app = (o: Record<string, unknown> = {}) => ({
    id: 5,
    guildId: G,
    channelId: APP_CHANNEL,
    status: 'opened',
    ...o,
  });

  test('pass: channel exists; closed rows and rows without a channel are ignored', async () => {
    const rows = [app(), app({ status: 'closed', channelId: GONE }), app({ status: 'created', channelId: null })];
    expect(await run(id, { Application: rows })).toEqual([]);
  });

  test('fail: open (or accepted) application whose channel was deleted', async () => {
    const [f] = await run(id, { Application: [app({ channelId: GONE, status: 'accepted' })] });
    expect(f).toMatchObject({
      code: 'application.open.channel_missing',
      severity: 'degraded',
      repair: 'confirm',
      entity: 'Application',
      rowId: 5,
      refId: GONE,
      params: { applicationId: 5, channelId: GONE },
    });
  });
});

describe('application system status', () => {
  const report = async (rows: LoadedRows) => {
    const guild = makeFakeGuild({ botPermissions: [PermissionFlagsBits.Administrator] });
    const loadRows = async (entity: string) => rows[entity as keyof LoadedRows] ?? [];
    return (await runHealthCheck(guild, { system: 'application' }, { loadRows })).systems.application;
  };

  test('not configured without an ApplicationConfig', async () => {
    expect(await report({ Position: [position({ isActive: false })] })).toEqual({
      status: 'not_configured',
      findings: [],
    });
  });

  test('a posted panel with no archive fails', async () => {
    const rows = { ApplicationConfig: [{ id: 1, channelId: PANEL, messageId: '', categoryId: null }] };
    const system = await report(rows);
    expect(system?.status).toBe('fail');
    expect(codes(system?.findings ?? [])).toContain('application.panel.archive_unset');
  });
});
