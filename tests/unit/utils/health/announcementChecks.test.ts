/**
 * Announcement health checks: the default channel and ping role, and template
 * rows (built-in defaults present, renderable color, embed limits).
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, type Guild, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_ANNOUNCEMENT_TEMPLATES } from '../../../../src/utils/announcement/defaultTemplates';
import { getChecks } from '../../../../src/utils/health/registry';
import { makeCheckContext } from '../../../helpers/healthContext';
import {
  BOT_PERMS,
  CATEGORY,
  codes,
  G,
  GONE_CHANNEL,
  GONE_ROLE,
  guildInit,
  LOCKED,
  MUTED_ROLE,
  NEWS,
  ROLE,
  runOne,
  TEXT,
} from './communityFixtures';
import { withThreadFetch } from './moderationHelpers';

const config = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  guildId: G,
  defaultChannelId: TEXT,
  defaultRoleId: ROLE,
  ...overrides,
});

describe('announcement.config', () => {
  const id = 'announcement.config';
  const run = (overrides: Record<string, unknown> = {}, guild = {}) =>
    runOne(id, { AnnouncementConfig: [config(overrides)] }, guild);

  test('pass: text or announcement channel and a mentionable role; no config at all', async () => {
    expect(await run()).toEqual([]);
    expect(await run({ defaultChannelId: NEWS, defaultRoleId: null })).toEqual([]);
    expect(await runOne(id, { AnnouncementConfig: [] })).toEqual([]);
  });

  test('fail: no default channel', async () => {
    const [f] = await run({ defaultChannelId: '' });
    expect(f).toMatchObject({
      code: 'announcement.config.channel_unset',
      system: 'announcement',
      severity: 'degraded',
      repair: 'manual',
      entity: 'AnnouncementConfig',
      rowId: 1,
      field: 'defaultChannelId',
    });
  });

  test('pass: an uncached default channel may be an archived thread, so a miss is not proof', async () => {
    expect(await run({ defaultChannelId: GONE_CHANNEL })).toEqual([]);
    expect(await run({ defaultChannelId: GONE_CHANNEL }, { available: false })).toEqual([]);
  });

  describe('deep: one REST lookup confirms an uncached default channel', () => {
    const deepRun = async (channelId: string, existing: string[] | 'error', deep = true) => {
      let fetched: string[] = [];
      const patch = (guild: Guild) => {
        if (existing !== 'error') fetched = withThreadFetch(guild, existing);
        else
          (guild.channels as unknown as Record<string, unknown>).fetch = async (fetchedId: string) => {
            fetched.push(fetchedId);
            throw Object.assign(new Error('rest 503'), { status: 503 });
          };
      };
      const rows = { AnnouncementConfig: [config({ defaultChannelId: channelId })] };
      return { findings: await runOne(id, rows, {}, { deep, patch }), fetched: () => fetched };
    };

    test('fail: Unknown Channel (deleted while the bot was offline) is channel_missing', async () => {
      const { findings, fetched } = await deepRun(GONE_CHANNEL, []);
      expect(findings).toEqual([
        expect.objectContaining({
          code: 'announcement.config.channel_missing',
          severity: 'degraded',
          repair: 'auto',
          entity: 'AnnouncementConfig',
          field: 'defaultChannelId',
          refId: GONE_CHANNEL,
          params: { channelId: GONE_CHANNEL },
        }),
      ]);
      expect(fetched()).toEqual([GONE_CHANNEL]);
    });

    test('pass: an archived thread found over REST, a failed lookup, or no deep mode', async () => {
      expect((await deepRun(GONE_CHANNEL, [GONE_CHANNEL])).findings).toEqual([]);
      expect((await deepRun(GONE_CHANNEL, 'error')).findings).toEqual([]);
      const shallow = await deepRun(GONE_CHANNEL, [], false);
      expect(shallow.findings).toEqual([]);
      expect(shallow.fetched()).toEqual([]);
    });

    test('a cached channel is never fetched', async () => {
      const { findings, fetched } = await deepRun(TEXT, []);
      expect(findings).toEqual([]);
      expect(fetched()).toEqual([]);
    });
  });

  test('fail: not a text or announcement channel, including a cached thread', async () => {
    expect(codes(await run({ defaultChannelId: CATEGORY }))).toEqual(['announcement.config.channel_wrong_type']);
    const THREAD = '300000000000000007';
    const withThread = { channels: [...(guildInit().channels ?? []), { id: THREAD, type: ChannelType.PublicThread }] };
    expect(codes(await run({ defaultChannelId: THREAD }, withThread))).toEqual([
      'announcement.config.channel_wrong_type',
    ]);
  });

  test('fail: the bot lacks permissions in the channel and they are listed', async () => {
    const [f] = await run({ defaultChannelId: LOCKED });
    expect(f).toMatchObject({
      code: 'announcement.config.channel_permissions',
      repair: 'manual',
      params: { channelId: LOCKED, permissions: 'Send Messages, Embed Links' },
    });
  });

  test('fail: deleted ping role (auto, the cleaner nulls it)', async () => {
    const [f] = await run({ defaultRoleId: GONE_ROLE });
    expect(f).toMatchObject({
      code: 'announcement.config.role_missing',
      severity: 'degraded',
      repair: 'auto',
      field: 'defaultRoleId',
      refId: GONE_ROLE,
    });
  });

  test('fail: non-mentionable role without MentionEveryone; pass with it', async () => {
    expect(codes(await run({ defaultRoleId: MUTED_ROLE }))).toEqual(['announcement.config.role_not_mentionable']);
    const withMention = { botPermissions: [...BOT_PERMS, PermissionFlagsBits.MentionEveryone] };
    expect(await run({ defaultRoleId: MUTED_ROLE }, withMention)).toEqual([]);
  });

  test('@everyone as the role: never "not mentionable"; without MentionEveryone it can\'t ping everyone', async () => {
    const [f] = await run({ defaultRoleId: G });
    expect(f).toMatchObject({
      code: 'announcement.config.role_everyone',
      severity: 'degraded',
      repair: 'manual',
      field: 'defaultRoleId',
      refId: G,
    });
    expect(codes(await run({ defaultRoleId: G }))).toEqual(['announcement.config.role_everyone']);
    const withMention = { botPermissions: [...BOT_PERMS, PermissionFlagsBits.MentionEveryone] };
    expect(await run({ defaultRoleId: G }, withMention)).toEqual([]);
  });

  test('isConfigured follows the config row', () => {
    const check = getChecks('announcement').find(c => c.id === id)!;
    expect(check.isConfigured?.(makeCheckContext({ rows: { AnnouncementConfig: [] } }))).toBe(false);
    expect(check.isConfigured?.(makeCheckContext({ rows: { AnnouncementConfig: [config()] } }))).toBe(true);
  });
});

describe('announcement.template', () => {
  const id = 'announcement.template';
  const defaults = DEFAULT_ANNOUNCEMENT_TEMPLATES.map((t, i) => ({ ...t, id: i + 1, guildId: G }));
  const run = (templates: Record<string, unknown>[], configured = true) =>
    runOne(id, { AnnouncementConfig: configured ? [config()] : [], AnnouncementTemplate: templates });

  test('pass: every default present and renderable', async () => {
    expect(await run(defaults)).toEqual([]);
  });

  test('fail: a default added later is missing (auto top-up)', async () => {
    const findings = await run(defaults.filter(t => t.name !== 'back-online'));
    expect(findings).toEqual([
      {
        code: 'announcement.template.default_missing',
        system: 'announcement',
        severity: 'cosmetic',
        repair: 'auto',
        entity: 'AnnouncementTemplate',
        params: { name: 'back-online' },
      },
    ]);
  });

  test('pass: a custom template that took a default name counts as present', async () => {
    const custom = defaults.map(t => (t.name === 'back-online' ? { ...t, isDefault: false } : t));
    expect(await run(custom)).toEqual([]);
  });

  test('pass: without announcements set up, missing defaults are not reported', async () => {
    expect(await run([], false)).toEqual([]);
  });

  test('fail: unparseable color; pass: colors renderTemplate can parse', async () => {
    const [f] = await run([...defaults, { ...defaults[0], id: 99, name: 'custom', color: 'red' }]);
    expect(f).toMatchObject({
      code: 'announcement.template.color_invalid',
      severity: 'degraded',
      repair: 'manual',
      rowId: 99,
      field: 'color',
      params: { name: 'custom', color: 'red' },
    });
    expect(await run([...defaults, { ...defaults[0], id: 99, name: 'custom', color: 'FFA500' }])).toEqual([]);
  });

  test('fail: over Discord embed limits (fields, field value, title, body)', async () => {
    const field = { name: 'n', value: 'v', inline: false };
    const cases = [
      { fields: Array.from({ length: 26 }, () => field) },
      { fields: [{ ...field, value: 'x'.repeat(1025) }] },
      { title: 'x'.repeat(257) },
      { body: 'x'.repeat(4097) },
    ];
    for (const overrides of cases) {
      const findings = await run([...defaults, { ...defaults[0], id: 99, name: 'custom', ...overrides }]);
      expect(codes(findings)).toEqual(['announcement.template.exceeds_limits']);
    }
  });
});
