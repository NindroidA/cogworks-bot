/**
 * `/bot-health repair` end to end: the handler runs the real checks on rows
 * in a fake database, the real planner and applier write through the real
 * store, and a click goes all the way to the rows. Pins the stale path (a
 * setting changed between preview and apply is left alone and reported) and
 * the proof re-check (a channel that came back is not removed from a list).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { type Guild, PermissionsBitField } from 'discord.js';
import { botHealthRepairHandler, type RepairDeps } from '../../../../src/commands/handlers/botHealth/repair';
import { REPAIR_CID } from '../../../../src/commands/handlers/botHealth/repairRender';
import type { HealthEntityName } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { applyRepairPlan } from '../../../../src/utils/health/repair/applier';
import { runHealthCheckWithContext } from '../../../../src/utils/health/runner';
import { rateLimiter } from '../../../../src/utils/security/rateLimiter';
import { makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeRepairDb } from '../../../helpers/repairDb';

const G = '100000000000000001';
const OWNER = '400000000000000001';
const ADMIN = '400000000000000002';
const CH = '300000000000000001';
const GONE = '300000000000000666';

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

/** The server language and the XP settings: two automatic fixes, nothing that asks Discord for commands. */
const CHECKS = getChecks().filter(check => check.id === 'core.locale' || check.id === 'xp.config');

function harness() {
  const guild = makeFakeGuild({ id: G, channels: [{ id: CH }], botPermissions: ['Administrator'] });
  const xp = {
    id: 9,
    guildId: G,
    enabled: true,
    ignoredChannels: [GONE],
    ignoredRoles: null,
    multiplierChannels: null,
    levelUpChannelId: null,
    xpPerMessageMin: 15,
    xpPerMessageMax: 25,
  };
  const { store, repo } = makeRepairDb({ BotConfig: [{ guildId: G, locale: 'jp' }], XPConfig: [xp] });
  // Copies, as from a database read.
  const loadRows = async (entity: HealthEntityName) => [...repo(entity).rows.values()].map(row => structuredClone(row));
  const audits: { guildId: string; action: string; triggeredBy: string; details: any; source: string }[] = [];
  const noop = () => {};
  const deps: RepairDeps = {
    runHealthCheckWithContext: (target, options) =>
      runHealthCheckWithContext(target, options, { checks: CHECKS, loadRows }),
    applyRepairPlan: (target, plan, actor) =>
      applyRepairPlan(target, plan, actor, {
        store,
        invalidateGuildCaches: noop,
        invalidateBaitCaches: noop,
        requestGuildCommandRefresh: noop,
        registerGuildCommands: async () => {},
        writeAuditLog: async (guildId, action, triggeredBy, details, source) => {
          audits.push({ guildId, action, triggeredBy, details, source });
        },
      }),
  };

  const collector = Object.assign(new EventEmitter(), { stop: () => collector.emit('end') });
  const edits: any[] = [];
  const member = { permissions: new PermissionsBitField(['Administrator']) };
  const interaction: any = {
    commandName: 'bot-health',
    user: { id: ADMIN, tag: 'admin' },
    guildId: G,
    guild,
    member,
    deferred: false,
    replied: false,
    isRepliable: () => true,
    options: { getString: () => null, getBoolean: () => null, getSubcommand: () => 'repair' },
    async reply() {
      interaction.replied = true;
    },
    async deferReply() {
      interaction.deferred = true;
    },
    async editReply(payload: unknown) {
      edits.push(payload);
      return { createMessageComponentCollector: () => collector };
    },
  };
  const press = async (customId: string) => {
    const sent = { updates: [] as any[], followUps: [] as any[] };
    const i: any = {
      customId,
      values: [],
      user: { id: ADMIN, tag: 'admin' },
      guildId: G,
      guild,
      member,
      deferred: false,
      replied: false,
      isRepliable: () => true,
      isStringSelectMenu: () => false,
      async update(payload: unknown) {
        sent.updates.push(payload);
        i.replied = true;
      },
      async reply() {},
      async followUp(payload: unknown) {
        sent.followUps.push(payload);
      },
      async deferUpdate() {},
    };
    collector.emit('collect', i);
    // The real applier and store chain many awaits.
    for (let n = 0; n < 20; n++) await new Promise(resolve => setTimeout(resolve, 0));
    return sent;
  };
  const run = () => botHealthRepairHandler({ guilds: { cache: new Map() } } as never, interaction, deps);
  const results = () => edits.at(-1).embeds[0].toJSON().description as string;
  return { guild: guild as Guild, repo, audits, edits, press, run, results };
}

describe('/bot-health repair, end to end', () => {
  test('a list changed between preview and apply is left alone and reported; the next pass fixes it', async () => {
    const h = harness();
    await h.run();
    const preview = h.edits[0].embeds[0].toJSON();
    expect(preview.fields[0]).toEqual({
      name: 'Automatic fixes (2)',
      value: '• Set the server language to English ×1\n• Remove the deleted channel from the XP ignored channels ×1',
    });

    // `/xp-setup ignore-channel-add` runs while the preview is open.
    h.repo('XPConfig').rows.get('9').ignoredChannels = [GONE, CH];
    await h.press(REPAIR_CID.auto);
    expect(h.results()).toContain('✅ Fixed: 1');
    expect(h.results()).toContain('Changed since the check, so left alone: 1');
    expect(h.repo('BotConfig').rows.get(G).locale).toBe('en');
    expect(h.repo('XPConfig').rows.get('9').ignoredChannels).toEqual([GONE, CH]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      guildId: G,
      action: 'command:bot-health:repair',
      triggeredBy: ADMIN,
      source: 'command',
      details: { counts: { applied: 1, stale: 1 } },
    });

    // The check that followed saw the new list: preview it and apply again.
    const again = await h.press(REPAIR_CID.again);
    expect(again.updates[0].embeds[0].toJSON().fields[0]).toEqual({
      name: 'Automatic fixes (1)',
      value: '• Remove the deleted channel from the XP ignored channels ×1',
    });
    await h.press(REPAIR_CID.auto);
    expect(h.results()).toContain('✅ Fixed: 1');
    expect(h.repo('XPConfig').rows.get('9').ignoredChannels).toEqual([CH]);
    // Nothing is left to fix, so there is no "Preview remaining fixes".
    expect(h.edits.at(-1).components).toEqual([]);
    expect(h.audits).toHaveLength(2);
  });

  test('a channel that came back between preview and apply stays in the list', async () => {
    const h = harness();
    await h.run();
    const channels = h.guild.channels.cache as unknown as Map<string, unknown>;
    channels.set(GONE, { ...channels.get(CH), id: GONE });
    await h.press(REPAIR_CID.auto);
    expect(h.results()).toContain('✅ Fixed: 1');
    expect(h.results()).toContain('Changed since the check, so left alone: 1');
    expect(h.repo('XPConfig').rows.get('9').ignoredChannels).toEqual([GONE]);
    expect(h.audits[0].details.counts).toMatchObject({ applied: 1, 'skipped-not-missing': 1 });
  });
});
