/**
 * /bot-reset Handler Unit Tests (v3.16.9 and v3.16.10 regressions)
 *
 * - Choosing "Save Data First" and then failing to deliver the archive used to
 *   purge everything anyway. Now nothing is deleted.
 * - The 24h limit was spent before the confirmation stages, so Cancel or the
 *   "too large" path locked the admin out for a day. It is now spent at the
 *   final confirmation and given back unless the whole purge finished.
 * - The reset PUT an empty command list, removing /bot-setup itself. It now
 *   re-registers the (config-filtered) command set after the purge.
 * - A purge whose tables failed was reported as "Factory Reset Complete", and
 *   any error claimed data "may have been partially deleted", even before
 *   anything was.
 * - (v3.16.10) With "Save Data First", cleanup deletes only what the archive
 *   holds (an allow-list); anything else is kept and listed. Transcript
 *   capture is timed from the slash command, and a summary the expired
 *   interaction token can't show is DMed instead.
 *
 * Strategy: drive the handler with a fake interaction whose reply message
 * yields scripted button clicks, and inject fake reset steps (BotResetDeps).
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type BotResetDeps, botResetHandler } from '../../../src/commands/handlers/botReset';
import { TRANSCRIPT_CAPTURE_BUDGET_MS } from '../../../src/utils/archive/transcriptCapture';
import { deleteAllGuildData } from '../../../src/utils/database/guildQueries';
import { createRateLimitKey, rateLimiter } from '../../../src/utils/security/rateLimiter';
import { type FakeRepo, makeRepo, patchRepositories } from '../utils/archive/fakeDiscord';

const GUILD = '200000000000000001';
const LIMIT_KEY = createRateLimitKey.guild(GUILD, 'bot-reset');

let repos: Record<string, FakeRepo> = {};
const restore = await patchRepositories(() => repos);
afterAll(restore);

// Same dance as rateLimiter.test.ts: force prod mode (dev mode bypasses limits) and re-read it.
const originalRelease = process.env.RELEASE;
beforeEach(() => {
  process.env.RELEASE = 'prod';
  rateLimiter.destroy();
  repos = {};
});
afterEach(() => {
  rateLimiter.reset(LIMIT_KEY);
  process.env.RELEASE = originalRelease;
  rateLimiter.destroy();
});

const COMMAND_AT = 1_790_000_000_000;

function makeInteraction(clicks: string[], opts: { dmFails?: boolean; summaryFails?: boolean } = {}) {
  const queue = [...clicks];
  const calls = { replies: [] as any[], edits: [] as any[], updates: [] as any[], dms: [] as any[] };
  const message = {
    awaitMessageComponent: async () => {
      const customId = queue.shift();
      if (!customId) throw new Error('time');
      return { customId, update: async (o: unknown) => calls.updates.push(o) };
    },
  };
  const interaction = {
    guildId: GUILD,
    guild: { name: 'Test Guild' },
    commandName: 'bot-reset',
    createdTimestamp: COMMAND_AT,
    member: { permissions: { has: () => true } },
    user: {
      id: 'admin-1',
      tag: 'admin#0001',
      send: async (o: unknown) => {
        if (opts.dmFails) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
        calls.dms.push(o);
      },
    },
    isRepliable: () => true,
    reply: async (o: unknown) => {
      calls.replies.push(o);
      return { resource: { message } };
    },
    editReply: async (o: any) => {
      if (opts.summaryFails && o.embeds?.[0]?.data?.title === 'Factory Reset Complete') {
        throw Object.assign(new Error('Invalid Webhook Token'), { code: 50027 });
      }
      calls.edits.push(o);
    },
  };
  return { interaction: interaction as any, calls };
}

const COVERAGE = { read: new Map([['th-read', 'th-read-m0']]), gone: new Set(['th-gone']) };

/** A client whose bait manager records cache clears into `order`. */
const clientLogging = (order: string[]) =>
  ({
    baitChannelManager: {
      clearConfigCache: () => order.push('bait-config'),
      clearKeywordCache: () => order.push('bait-keywords'),
    },
  }) as any;

function makeDeps(opts: { sizeBytes?: number; kept?: string[] } = {}) {
  const order: string[] = [];
  let cleanupOptions: unknown;
  let compileOptions: unknown;
  const deps: BotResetDeps = {
    compileGuildArchive: async (_guildId, _client, options) => {
      order.push('compile');
      compileOptions = options;
      return {
        buffer: Buffer.from('archive'),
        filename: 'cogworks-archive.json.gz',
        stats: {
          archivedTickets: 2,
          archivedApplications: 1,
          memoryItems: 0,
          transcripts: 3,
          totalEntries: 12,
          compressedSizeBytes: opts.sizeBytes ?? 2048,
        },
        coverage: COVERAGE,
      };
    },
    cleanupGuildMessages: async (_client, _guildId, options) => {
      order.push('cleanup');
      cleanupOptions = options;
      return { deleted: 4, failed: 0, details: [], keptChannelIds: opts.kept ?? [] };
    },
    deleteAllGuildData: async () => {
      order.push('purge');
      return { success: true, total: 40, tables: 45, details: {}, failed: [] };
    },
    registerGuildCommands: async () => {
      order.push('register');
    },
  };
  return { deps, order, cleanupOptions: () => cleanupOptions, compileOptions: () => compileOptions };
}

const lastEmbed = (calls: { edits: any[] }) => calls.edits.at(-1)?.embeds?.[0]?.data;
const fieldsOf = (embed: { fields: Array<{ name: string; value: string }> }) =>
  Object.fromEntries(embed.fields.map(f => [f.name, f.value]));
const SAVE = ['reset_continue', 'reset_save_yes', 'reset_confirm_final'];
const NO_SAVE = ['reset_continue', 'reset_save_no', 'reset_confirm_final'];

describe('/bot-reset', () => {
  test('cancelling does not use up the daily reset', async () => {
    const { interaction, calls } = makeInteraction(['reset_cancel']);
    const { deps, order } = makeDeps();
    await botResetHandler({} as any, interaction, deps);

    expect(calls.updates.at(-1).content).toBe('Reset cancelled.');
    expect(order).toEqual([]);
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });

  test('archive DM failure aborts before anything is deleted', async () => {
    const { interaction, calls } = makeInteraction(SAVE, { dmFails: true });
    const { deps, order } = makeDeps();
    await botResetHandler({} as any, interaction, deps);

    expect(order).toEqual(['compile']);
    expect(lastEmbed(calls).title).toBe('Reset Aborted');
    expect(lastEmbed(calls).description).toContain('nothing was deleted');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });

  test('an archive too large to DM aborts before anything is deleted', async () => {
    const { interaction, calls } = makeInteraction(SAVE);
    const { deps, order } = makeDeps({ sizeBytes: 9 * 1024 * 1024 });
    await botResetHandler({} as any, interaction, deps);

    expect(order).toEqual(['compile']);
    expect(calls.dms).toEqual([]);
    expect(lastEmbed(calls).title).toBe('Archive Too Large');
    // /archive cleanup only shrinks ticket/application archives; the message must not promise more.
    expect(lastEmbed(calls).description).toContain("can't shrink memory items, XP, activity, analytics or log data");
    expect(lastEmbed(calls).description).toContain('No, Delete Everything');
    // /data-export has the same 8 MB cap; it is only offered as smaller (no transcripts), not as a sure fix.
    expect(lastEmbed(calls).description).toContain('may fit under the same 8 MB limit');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });

  test('the save prompt says the archive holds every table plus transcripts', async () => {
    const { interaction, calls } = makeInteraction(['reset_continue', 'reset_cancel2']);
    const { deps } = makeDeps();
    await botResetHandler({} as any, interaction, deps);

    const stage2 = calls.updates[0].embeds[0].data.description as string;
    expect(stage2).toContain('every Cogworks record for this server (configurations');
    expect(stage2).toContain('XP data');
    expect(stage2).toContain('text of every transcript');
  });

  test('saved reset deletes only what the archive holds, purges, then re-registers commands', async () => {
    const { interaction, calls } = makeInteraction(SAVE);
    const { deps, order, cleanupOptions, compileOptions } = makeDeps({ kept: ['th-x'] });
    await botResetHandler(clientLogging(order), interaction, deps);

    expect(calls.dms).toHaveLength(1);
    expect(calls.dms[0].content).toContain('12 entries + 3 transcripts');
    const bait = ['bait-config', 'bait-keywords'];
    expect(order).toEqual(['compile', 'cleanup', ...bait, 'purge', ...bait, 'register']);
    // An allow-list: cleanup gets what the archive covers, not a list of what to spare.
    expect(cleanupOptions()).toEqual({ exported: COVERAGE });
    // The capture deadline counts from the slash command, not from the final click.
    expect(compileOptions()).toEqual({ deadline: COMMAND_AT + TRANSCRIPT_CAPTURE_BUDGET_MS });
    const summary = lastEmbed(calls);
    expect(summary.title).toBe('Factory Reset Complete');
    expect(fieldsOf(summary).Commands).toBe('Reset to the setup commands');
    expect(fieldsOf(summary)['Left in place']).toContain('<#th-x>');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(0);

    // The finished reset used up today's run.
    const second = makeInteraction(['reset_continue']);
    await botResetHandler({} as any, second.interaction, deps);
    expect(second.calls.replies[0].content).toContain('once per day');
  });

  test('reset without saving skips the archive and still re-registers commands after the purge', async () => {
    const { interaction, calls } = makeInteraction(NO_SAVE);
    const { deps, order, cleanupOptions } = makeDeps();
    await botResetHandler({} as any, interaction, deps);

    expect(order).toEqual(['cleanup', 'purge', 'register']);
    expect(cleanupOptions()).toEqual({});
    expect(calls.dms).toEqual([]);
    expect(lastEmbed(calls).title).toBe('Factory Reset Complete');
  });

  test('a summary the expired token cannot show is DMed, and the finished reset keeps its limit spent', async () => {
    const { interaction, calls } = makeInteraction(NO_SAVE, { summaryFails: true });
    const { deps, order } = makeDeps();
    await botResetHandler({} as any, interaction, deps);

    expect(order).toEqual(['cleanup', 'purge', 'register']);
    expect(calls.dms.at(-1).embeds[0].data.title).toBe('Factory Reset Complete');
    expect(calls.edits.some(e => String(e.content ?? '').includes('An error occurred'))).toBe(false);
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(0);
  });

  test('a command refresh failure is reported, and the finished reset still counts', async () => {
    const { interaction, calls } = makeInteraction(NO_SAVE);
    const { deps } = makeDeps();
    deps.registerGuildCommands = async () => {
      throw new Error('Missing Access');
    };
    await botResetHandler({} as any, interaction, deps);

    const summary = lastEmbed(calls);
    expect(summary.title).toBe('Factory Reset Complete');
    expect(fieldsOf(summary).Commands).toContain('`/bot-setup` is still available');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(0);
  });

  test('tables the real purge failed on make the reset incomplete and give the day back', async () => {
    // The real deleteAllGuildData never throws once its loop runs: safeDbOperation
    // swallows a table's error and the table is reported in `failed`.
    const xpUsers = makeRepo([{ guildId: GUILD, userId: 'u1' }]);
    xpUsers.delete = async () => {
      throw new Error('ER_LOCK_WAIT_TIMEOUT');
    };
    repos = { XPUser: xpUsers, BotConfig: makeRepo([{ guildId: GUILD }]) };
    const { interaction, calls } = makeInteraction(NO_SAVE);
    const { deps, order } = makeDeps();
    deps.deleteAllGuildData = deleteAllGuildData;
    await botResetHandler({} as any, interaction, deps);

    expect(repos.BotConfig.rows).toEqual([]); // the other tables were still purged
    expect(order).toEqual(['cleanup', 'register']);
    const summary = lastEmbed(calls);
    expect(summary.title).toBe('Factory Reset Incomplete');
    expect(fieldsOf(summary).Database).toContain('failed: XPUser');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });

  test('an error before anything was deleted says so, and gives the day back', async () => {
    const { interaction, calls } = makeInteraction(SAVE);
    const { deps, order } = makeDeps();
    deps.compileGuildArchive = async () => {
      throw new Error('ER_CON_COUNT_ERROR');
    };
    await botResetHandler({} as any, interaction, deps);

    expect(order).toEqual([]);
    expect(calls.edits.at(-1).content).toContain('nothing was deleted');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });

  test('an error once deletion started warns about partial deletion, and gives the day back', async () => {
    const { interaction, calls } = makeInteraction(NO_SAVE);
    const { deps } = makeDeps();
    deps.cleanupGuildMessages = async () => {
      throw new Error('socket hang up');
    };
    await botResetHandler({} as any, interaction, deps);

    expect(calls.edits.at(-1).content).toContain('partially deleted');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });
});
