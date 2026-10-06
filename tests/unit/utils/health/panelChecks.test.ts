/**
 * Panel and archive-forum health checks, shared by tickets and applications:
 * every invariant runs once per system, with a pass and a fail case.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { LoadedRows } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runCheck } from '../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../src/utils/health/types';
import { type FakeChannelInit, type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

const PANEL = '300000000000000001';
const CATEGORY = '300000000000000002';
const ARCHIVE = '300000000000000003';
const VOICE = '300000000000000004';
const GONE = '300000000000000666';
const MESSAGE = '400000000000000001';

const {
  Administrator,
  ViewChannel,
  SendMessages,
  SendMessagesInThreads,
  EmbedLinks,
  AttachFiles,
  ReadMessageHistory,
  ManageChannels,
} = PermissionFlagsBits;

function channels(
  overrides: Record<string, Partial<FakeChannelInit> & Record<string, unknown>> = {},
): FakeChannelInit[] {
  const base: Record<string, FakeChannelInit & Record<string, unknown>> = {
    [PANEL]: { id: PANEL, type: ChannelType.GuildText, messages: { fetch: async () => ({ id: MESSAGE }) } },
    [CATEGORY]: { id: CATEGORY, type: ChannelType.GuildCategory },
    [ARCHIVE]: { id: ARCHIVE, type: ChannelType.GuildForum, availableTags: [] },
    [VOICE]: { id: VOICE, type: ChannelType.GuildVoice },
  };
  return Object.values(base).map(c => ({ ...c, ...overrides[c.id] }) as FakeChannelInit);
}

async function run(
  checkId: string,
  rows: LoadedRows,
  guild: FakeGuildInit = {},
  opts: { deep?: boolean } = {},
): Promise<HealthFinding[]> {
  const check = getChecks().find(c => c.id === checkId);
  if (!check) throw new Error(`no check ${checkId}`);
  const fake = makeFakeGuild({ botPermissions: [Administrator], channels: channels(), ...guild });
  return (await runCheck(check, makeCheckContext({ guild: fake, rows, deep: opts.deep }))).findings;
}

const codes = (findings: HealthFinding[]) => findings.map(f => f.code);

describe.each([
  ['ticket', 'TicketConfig', 'ArchivedTicketConfig', 'CustomTicketType', { isActive: true, displayName: 'Bug Report' }],
  [
    'application',
    'ApplicationConfig',
    'ArchivedApplicationConfig',
    'Position',
    { isActive: true, title: 'Bug Report' },
  ],
] as const)('%s panel and archive', (system, configEntity, archiveEntity, typeEntity, activeType) => {
  const panelId = `${system}.panel`;
  const archiveId = `${system}.archive`;

  const config = (o: Record<string, unknown> = {}) => ({
    id: 1,
    channelId: PANEL,
    messageId: MESSAGE,
    categoryId: CATEGORY,
    ...o,
  });
  const archive = (o: Record<string, unknown> = {}) => ({ id: 2, channelId: ARCHIVE, messageId: '', ...o });
  const panelRows = (c = config(), a: unknown[] = [archive()]): LoadedRows => ({
    [configEntity]: [c],
    [archiveEntity]: a,
  });
  const archiveRows = (a = archive(), types: unknown[] = [activeType]): LoadedRows => ({
    [archiveEntity]: [a],
    [typeEntity]: types,
  });

  describe('panel', () => {
    test('pass: panel, category and archive all usable', async () => {
      expect(await run(panelId, panelRows())).toEqual([]);
    });

    test('pass: nothing to check without a posted panel', async () => {
      expect(await run(panelId, { [configEntity]: [], [archiveEntity]: [] })).toEqual([]);
      expect(await run(panelId, panelRows(config({ channelId: '', categoryId: null }), []))).toEqual([]);
    });

    test('fail: panel channel deleted', async () => {
      const findings = await run(panelId, panelRows(config({ channelId: GONE })));
      expect(findings).toEqual([
        expect.objectContaining({
          code: `${panelId}.channel_missing`,
          system,
          severity: 'block',
          repair: 'auto',
          entity: configEntity,
          rowId: 1,
          field: 'channelId',
          refId: GONE,
          params: { channelId: GONE },
        }),
      ]);
    });

    test('fail: panel channel is not a text channel', async () => {
      expect(codes(await run(panelId, panelRows(config({ channelId: VOICE }))))).toEqual([`${panelId}.channel_type`]);
    });

    // Only the application panel is fetched and edited later (when positions change).
    const editsPanel = system === 'application';

    test('posted panel: missing permissions only matter for posting again (and editing, for applications)', async () => {
      const guild = { channels: channels({ [PANEL]: { botPermissions: [ViewChannel] } }) };
      const [f] = await run(panelId, panelRows(), guild);
      expect(f).toMatchObject({
        code: `${panelId}.channel_permissions`,
        severity: editsPanel ? 'degraded' : 'cosmetic',
        repair: 'manual',
        params: { channelId: PANEL, permissions: editsPanel ? 'SendMessages, ReadMessageHistory' : 'SendMessages' },
      });
    });

    test('posted panel: no Embed Links needed; Send Messages alone is cosmetic', async () => {
      const viewOnly = { channels: channels({ [PANEL]: { botPermissions: [ViewChannel, SendMessages] } }) };
      if (editsPanel) {
        const [f] = await run(panelId, panelRows(), viewOnly);
        expect(f).toMatchObject({ severity: 'degraded', params: { permissions: 'ReadMessageHistory' } });
      } else expect(await run(panelId, panelRows(), viewOnly)).toEqual([]);
      const noSend = { channels: channels({ [PANEL]: { botPermissions: [ViewChannel, ReadMessageHistory] } }) };
      const [f] = await run(panelId, panelRows(), noSend);
      expect(f).toMatchObject({ severity: 'cosmetic', params: { permissions: 'SendMessages' } });
      const all = [ViewChannel, SendMessages, ReadMessageHistory];
      expect(await run(panelId, panelRows(), { channels: channels({ [PANEL]: { botPermissions: all } }) })).toEqual([]);
    });

    test('panel not posted (blank messageId): reported without deep mode or any fetch', async () => {
      let calls = 0;
      const fetch = async () => {
        calls++;
        return { id: MESSAGE };
      };
      const guild = { channels: channels({ [PANEL]: { messages: { fetch } } }) };
      for (const deep of [false, true]) {
        const findings = await run(panelId, panelRows(config({ messageId: '' })), guild, { deep });
        expect(findings).toEqual([
          expect.objectContaining({
            code: `${panelId}.message_missing`,
            severity: 'degraded',
            repair: 'confirm',
            entity: configEntity,
            rowId: 1,
            field: 'messageId',
            params: { channelId: PANEL },
          }),
        ]);
        expect(findings[0].refId).toBeUndefined();
      }
      expect(calls).toBe(0);
    });

    test('panel not posted and the bot cannot post it: both degraded', async () => {
      const guild = { channels: channels({ [PANEL]: { botPermissions: [ViewChannel] } }) };
      const findings = await run(panelId, panelRows(config({ messageId: '' })), guild);
      expect(findings.map(f => [f.code, f.severity])).toEqual([
        [`${panelId}.channel_permissions`, 'degraded'],
        [`${panelId}.message_missing`, 'degraded'],
      ]);
    });

    test('a deleted or wrong-kind panel channel is not also reported as an unposted panel', async () => {
      expect(codes(await run(panelId, panelRows(config({ channelId: GONE, messageId: '' }))))).toEqual([
        `${panelId}.channel_missing`,
      ]);
      expect(codes(await run(panelId, panelRows(config({ channelId: VOICE, messageId: '' }))))).toEqual([
        `${panelId}.channel_type`,
      ]);
    });

    test('pass: no permission findings without a cached bot member', async () => {
      expect(await run(panelId, panelRows(), { botPermissions: null })).toEqual([]);
    });

    test('pass: an unavailable guild proves nothing is gone', async () => {
      const rows = panelRows(config({ channelId: GONE, categoryId: GONE }));
      expect(await run(panelId, rows, { available: false })).toEqual([]);
    });

    test('deep: panel message present → pass; deleted (10008) → message_missing', async () => {
      expect(await run(panelId, panelRows(), {}, { deep: true })).toEqual([]);
      const guild = {
        channels: channels({ [PANEL]: { messages: { fetch: () => Promise.reject({ code: 10008 }) } } }),
      };
      const findings = await run(panelId, panelRows(), guild, { deep: true });
      expect(findings).toEqual([
        expect.objectContaining({
          code: `${panelId}.message_missing`,
          severity: 'degraded',
          repair: 'confirm',
          field: 'messageId',
          refId: MESSAGE,
        }),
      ]);
    });

    test('deep: a failed fetch (5xx) is not proof; without deep the message is never fetched', async () => {
      let calls = 0;
      const fetch = () => {
        calls++;
        return Promise.reject({ status: 503 });
      };
      const guild = { channels: channels({ [PANEL]: { messages: { fetch } } }) };
      expect(await run(panelId, panelRows(), guild, { deep: true })).toEqual([]);
      expect(calls).toBe(1);
      expect(await run(panelId, panelRows(), guild)).toEqual([]);
      expect(calls).toBe(1);
    });

    test('fail: no category set', async () => {
      const [f] = await run(panelId, panelRows(config({ categoryId: null })));
      expect(f).toMatchObject({ code: `${panelId}.category_unset`, severity: 'block', field: 'categoryId' });
    });

    test('fail: category deleted, or not a category', async () => {
      expect(codes(await run(panelId, panelRows(config({ categoryId: GONE }))))).toEqual([
        `${panelId}.category_missing`,
      ]);
      expect(codes(await run(panelId, panelRows(config({ categoryId: PANEL }))))).toEqual([`${panelId}.category_type`]);
    });

    test('fail: bot lacks Manage Roles in the category', async () => {
      const guild = { channels: channels({ [CATEGORY]: { botPermissions: [ViewChannel, ManageChannels] } }) };
      const [f] = await run(panelId, panelRows(), guild);
      expect(f).toMatchObject({ code: `${panelId}.category_permissions`, params: { permissions: 'ManageRoles' } });
    });

    test('category with 49 channels passes; 50 is full', async () => {
      const children = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          id: `31000000000000${String(i).padStart(4, '0')}`,
          parentId: CATEGORY,
        }));
      expect(await run(panelId, panelRows(), { channels: [...channels(), ...children(49)] })).toEqual([]);
      const [f] = await run(panelId, panelRows(), { channels: [...channels(), ...children(50)] });
      expect(f).toMatchObject({ code: `${panelId}.category_full`, severity: 'block', params: { count: 50 } });
    });

    test('fail: panel posted but no archive forum, so nothing can be closed', async () => {
      expect(codes(await run(panelId, panelRows(config(), [])))).toEqual([`${panelId}.archive_unset`]);
      expect(codes(await run(panelId, panelRows(config(), [archive({ channelId: '' })])))).toEqual([
        `${panelId}.archive_unset`,
      ]);
    });
  });

  describe('archive forum', () => {
    test('pass: usable forum; nothing to check when unset', async () => {
      expect(await run(archiveId, archiveRows())).toEqual([]);
      expect(await run(archiveId, archiveRows(archive({ channelId: '' })))).toEqual([]);
    });

    test('fail: forum deleted', async () => {
      const [f] = await run(archiveId, archiveRows(archive({ channelId: GONE })));
      expect(f).toMatchObject({
        code: `${archiveId}.channel_missing`,
        severity: 'block',
        repair: 'auto',
        entity: archiveEntity,
        refId: GONE,
      });
    });

    test('fail: archive is not a forum', async () => {
      expect(codes(await run(archiveId, archiveRows(archive({ channelId: PANEL }))))).toEqual([
        `${archiveId}.channel_type`,
      ]);
    });

    test('fail: bot cannot post or attach files in the forum', async () => {
      const guild = { channels: channels({ [ARCHIVE]: { botPermissions: [ViewChannel, SendMessages] } }) };
      const findings = await run(archiveId, archiveRows(), guild);
      expect(findings).toEqual([
        expect.objectContaining({
          code: `${archiveId}.channel_permissions`,
          severity: 'block',
          params: { channelId: ARCHIVE, permissions: 'SendMessagesInThreads, EmbedLinks, AttachFiles' },
        }),
        expect.objectContaining({ code: `${archiveId}.tag_permissions`, severity: 'degraded' }),
      ]);
    });

    test('only Manage Channels missing: closes still work, new tags cannot be created (degraded)', async () => {
      const allButManage = [ViewChannel, SendMessages, SendMessagesInThreads, EmbedLinks, AttachFiles];
      const guild = { channels: channels({ [ARCHIVE]: { botPermissions: allButManage } }) };
      expect(await run(archiveId, archiveRows(), guild)).toEqual([
        expect.objectContaining({
          code: `${archiveId}.tag_permissions`,
          severity: 'degraded',
          repair: 'manual',
          field: 'channelId',
          refId: ARCHIVE,
          params: { channelId: ARCHIVE },
        }),
      ]);
      const withManage = { channels: channels({ [ARCHIVE]: { botPermissions: [...allButManage, ManageChannels] } }) };
      expect(await run(archiveId, archiveRows(), withManage)).toEqual([]);
    });

    const tags = (names: string[]) => names.map((name, i) => ({ id: `t${i}`, name }));
    const filler = Array.from({ length: 19 }, (_, i) => `tag ${i}`);

    test('pass: 20 tags that already include every needed tag (case-insensitive)', async () => {
      const needed = system === 'ticket' ? ['bug report'] : ['bug report', 'Accepted', 'Rejected'];
      const all = [...filler.slice(0, 20 - needed.length), ...needed];
      const guild = { channels: channels({ [ARCHIVE]: { availableTags: tags(all) } }) };
      expect(await run(archiveId, archiveRows(), guild)).toEqual([]);
    });

    test('fail: 20 tags and an active type/position has none', async () => {
      const guild = { channels: channels({ [ARCHIVE]: { availableTags: tags([...filler, 'Other']) } }) };
      const [f] = await run(archiveId, archiveRows(), guild);
      expect(f).toMatchObject({ code: `${archiveId}.tags_full`, severity: 'degraded', repair: 'manual' });
      expect(String(f.params.names)).toContain('Bug Report');
    });

    test('pass: under 20 tags, or only inactive types/positions lack one', async () => {
      const guild19 = { channels: channels({ [ARCHIVE]: { availableTags: tags(filler) } }) };
      expect(await run(archiveId, archiveRows(), guild19)).toEqual([]);
      if (system === 'ticket') {
        const full = { channels: channels({ [ARCHIVE]: { availableTags: tags([...filler, 'Other']) } }) };
        expect(await run(archiveId, archiveRows(archive(), [{ ...activeType, isActive: false }]), full)).toEqual([]);
      }
    });
  });
});
