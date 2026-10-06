/**
 * Guild purge + export coverage (v3.16.8).
 *
 * - GuildPermission rows used to survive deleteAllGuildData (guild leave and
 *   /bot-reset) and were missing from /data-export, so role grants outlived a
 *   factory reset. The coverage tests diff both lists against the DataSource
 *   so a new entity can't be missed again.
 * - Warm config caches kept acting on purged config. /bot-reset and guild
 *   leave also clear the bait config and keyword caches, which live on the
 *   client, on both sides of the purge.
 * - A table that failed to purge was only logged; it is now reported in
 *   `failed` so /bot-reset can say the reset is incomplete (v3.16.9).
 * - /bot-reset left open ticket/application channels behind, and deleted
 *   transcript threads it could not export. With "Save Data First" it now
 *   deletes only what the archive holds, unchanged: a ticket opened or a
 *   thread updated while the archive was being made is kept (v3.16.10).
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import { version } from '../../../../package.json';
import guildDelete from '../../../../src/events/guildDelete';
import { AppDataSource } from '../../../../src/typeorm';
import { captureTranscripts, exportCoverage } from '../../../../src/utils/archive/transcriptCapture';
import { deleteAllGuildData } from '../../../../src/utils/database/guildQueries';
import { compileGuildArchive, transcriptChannelIds } from '../../../../src/utils/offboarding/archiveCompiler';
import { invalidateBaitCaches } from '../../../../src/utils/offboarding/guildCaches';
import { EXPORT_ENTITIES } from '../../../../src/utils/offboarding/guildDataExport';
import { cleanupGuildMessages } from '../../../../src/utils/offboarding/messageCleanup';
import { hasFeatureAccess } from '../../../../src/utils/validation/featurePermission';
import { type FakeRepo, GUILD, makeChannel, makeClient, makeRepo, patchRepositories } from '../archive/fakeDiscord';

/** Not guild data (global singletons) or removed by FK cascade from a purged parent. */
const NOT_GUILD_SCOPED = new Set(['BotStatus', 'StatusIncident', 'ReactionRoleOption']);

const guildEntityNames = () =>
  (AppDataSource.options.entities as Array<{ name: string }>).map(e => e.name).filter(n => !NOT_GUILD_SCOPED.has(n));

let repos: Record<string, FakeRepo> = {};
const restore = await patchRepositories(() => repos);
afterAll(restore);
beforeEach(() => {
  repos = {};
});

describe('deleteAllGuildData coverage', () => {
  test('purges every guild-scoped entity, including GuildPermission', async () => {
    const purged = new Set<string>();
    repos = new Proxy({} as Record<string, FakeRepo>, {
      get: (_target, name: string) => {
        const repo = makeRepo();
        repo.delete = async () => {
          purged.add(name);
          return { affected: 0 };
        };
        return repo;
      },
    });

    const result = await deleteAllGuildData(GUILD);

    expect(result.success).toBe(true);
    expect(result.failed).toEqual([]);
    expect(purged.has('GuildPermission')).toBe(true);
    expect(guildEntityNames().filter(n => !purged.has(n))).toEqual([]);
  });

  test('reports the tables whose delete failed, and still purges the rest', async () => {
    const xpUsers = makeRepo([{ guildId: GUILD, userId: 'u1' }]);
    xpUsers.delete = async () => {
      throw new Error('ER_LOCK_WAIT_TIMEOUT');
    };
    repos = { XPUser: xpUsers, BotConfig: makeRepo([{ guildId: GUILD }]) };

    const result = await deleteAllGuildData(GUILD);

    // Not a throw and not success:false: callers must check `failed` to see an incomplete purge.
    expect(result.success).toBe(true);
    expect(result.failed).toEqual(['XPUser']);
    expect(result.total).toBe(1);
    expect(repos.BotConfig.rows).toEqual([]);
    expect(repos.XPUser.rows).toHaveLength(1);
  });

  test('drops cached role grants, so a reset revokes them immediately', async () => {
    const guildId = '100000000000000777';
    repos = { GuildPermission: makeRepo([{ guildId, feature: 'tickets', roleId: 'R1', level: 'admin' }]) };
    const interaction = {
      guild: {},
      guildId,
      member: { permissions: { has: () => false }, roles: { cache: new Map([['R1', {}]]) } },
    } as any;

    expect((await hasFeatureAccess(interaction, 'tickets', 'admin')).allowed).toBe(true); // now cached
    await deleteAllGuildData(guildId);

    expect(repos.GuildPermission.rows).toEqual([]);
    expect((await hasFeatureAccess(interaction, 'tickets', 'admin')).allowed).toBe(false);
  });
});

describe('export coverage', () => {
  test('/data-export and the reset archive include every guild-scoped entity, and nothing global', () => {
    const exported = new Set(EXPORT_ENTITIES.map(e => (e.entity as { name: string }).name));
    expect(guildEntityNames().filter(n => !exported.has(n))).toEqual([]);
    expect(exported.has('BotStatus')).toBe(false);
  });
});

describe('invalidateBaitCaches', () => {
  test('clears the bait config and keyword caches', () => {
    const cleared: string[] = [];
    const client = {
      baitChannelManager: {
        clearConfigCache: (id: string) => cleared.push(`config:${id}`),
        clearKeywordCache: (id: string) => cleared.push(`keywords:${id}`),
      },
    } as any;

    invalidateBaitCaches(client, GUILD);

    expect(cleared).toEqual([`config:${GUILD}`, `keywords:${GUILD}`]);
  });

  test('is best-effort: no manager, or a throwing one, never breaks the reset', () => {
    const throwing = {
      baitChannelManager: {
        clearConfigCache: () => {
          throw new Error('boom');
        },
      },
    } as any;

    expect(() => invalidateBaitCaches({} as any, GUILD)).not.toThrow();
    expect(() => invalidateBaitCaches(throwing, GUILD)).not.toThrow();
  });
});

describe('guildDelete', () => {
  test('clears the bait caches before and after the purge', async () => {
    const log: string[] = [];
    repos = new Proxy({} as Record<string, FakeRepo>, {
      get: () => {
        const repo = makeRepo();
        repo.delete = async () => {
          if (log.at(-1) !== 'purge') log.push('purge');
          return { affected: 0 };
        };
        return repo;
      },
    });
    const client = {
      baitChannelManager: {
        clearConfigCache: (id: string) => log.push(`config:${id}`),
        clearKeywordCache: (id: string) => log.push(`keywords:${id}`),
      },
      guilds: { cache: { size: 0 } },
    } as any;
    const guild = { id: GUILD, name: 'Test Guild', memberCount: 1 } as any;

    await guildDelete.execute(guild, client);

    expect(log).toEqual([`config:${GUILD}`, `keywords:${GUILD}`, 'purge', `config:${GUILD}`, `keywords:${GUILD}`]);
  });
});

describe('transcriptChannelIds', () => {
  test('collects archive threads, memory threads and open (not closed) ticket/application channels', () => {
    const ids = transcriptChannelIds({
      archivedTickets: [{ messageId: 'at1' }, { messageId: null }],
      archivedApplications: [{ messageId: 'aa1' }],
      memoryItems: [{ threadId: 'm1' }],
      tickets: [
        { channelId: 'open-t', status: 'opened' },
        { channelId: 'closed-t', status: 'closed' },
      ],
      applications: [{ channelId: 'open-a', status: 'accepted' }],
    });
    expect(ids).toEqual(['at1', 'aa1', 'm1', 'open-t', 'open-a']);
  });
});

describe('compileGuildArchive', () => {
  test("keeps v1's top-level tables and version for the dashboard's Archive Viewer, plus transcripts", async () => {
    repos = {
      ArchivedTicket: makeRepo([{ guildId: GUILD, messageId: 'th-a' }]),
      BaitChannelLog: makeRepo([{ guildId: GUILD, userId: 'u1' }]),
    };
    const client = makeClient({ 'th-a': makeChannel('th-a', ['hello']) });
    client.guilds.cache.set(GUILD, { name: 'Test Guild' });

    const archive = await compileGuildArchive(GUILD, client);
    const file = JSON.parse(gunzipSync(archive.buffer).toString());

    expect(file.format).toBe('cogworks-archive-v2');
    expect(file.metadata).toMatchObject({ guildId: GUILD, guildName: 'Test Guild', version });
    expect(file.archivedTickets).toHaveLength(1);
    expect(file.baitLogs).toHaveLength(1); // v1's name for BaitChannelLog rows
    expect(file.data).toBeUndefined();
    expect(file.transcripts['th-a'].messages[0].content).toBe('hello');
    expect(archive.coverage.read.get('th-a')).toBe('th-a-m0');
  });
});

describe('cleanupGuildMessages', () => {
  const seed = () => {
    repos = {
      ArchivedTicket: makeRepo([
        { guildId: GUILD, messageId: 'th-a' },
        { guildId: GUILD, messageId: 'th-returning' },
      ]),
      MemoryItem: makeRepo([{ guildId: GUILD, threadId: 'mem-1' }]),
      Ticket: makeRepo([
        { guildId: GUILD, channelId: 'tc-open', status: 'opened' },
        { guildId: GUILD, channelId: 'tc-closed', status: 'closed' },
        { guildId: GUILD, channelId: null, status: 'opened' },
      ]),
      Application: makeRepo([
        { guildId: GUILD, channelId: 'ac-open', status: 'accepted' },
        { guildId: GUILD, channelId: 'ac-locked', status: 'opened' },
      ]),
    };
    return {
      'th-a': makeChannel('th-a', ['transcript a']),
      'th-returning': makeChannel('th-returning', ['first transcript']),
      'mem-1': makeChannel('mem-1', ['memory']),
      'tc-open': makeChannel('tc-open', ['open ticket']),
      'tc-closed': makeChannel('tc-closed'),
      'ac-open': makeChannel('ac-open', ['open application']),
      'ac-locked': makeChannel('ac-locked', ['locked'], { deleteError: 50013 }),
      'tc-new': makeChannel('tc-new', ['opened mid-archive']),
    };
  };
  const deletedIds = (channels: Record<string, { id: string; deleted: boolean }>) =>
    Object.values(channels)
      .filter(c => c.deleted)
      .map(c => c.id);

  test('without an export: deletes threads and open channels, keeps undeletable ones and closed tickets', async () => {
    const channels = seed();
    const result = await cleanupGuildMessages(makeClient(channels), GUILD);

    expect(deletedIds(channels)).toEqual(['th-a', 'th-returning', 'mem-1', 'tc-open', 'ac-open']);
    expect(result.keptChannelIds).toEqual(['ac-locked']);
    expect(result.deleted).toBe(5);
    expect(result.failed).toBe(1);
  });

  test('with an export: deletes only what it holds unchanged; later tickets and new messages are kept', async () => {
    const channels = seed();
    const client = makeClient(channels);
    // The archive reads everything except th-a (say, unreadable at the time).
    const capture = await captureTranscripts(client, GUILD, [
      'th-returning',
      'mem-1',
      'tc-open',
      'ac-open',
      'ac-locked',
    ]);
    // While it was DMed: a member opened a ticket, and a returning user's close appended to their thread.
    repos.Ticket.rows.push({ guildId: GUILD, channelId: 'tc-new', status: 'opened' });
    channels['th-returning'].post('second transcript');

    const result = await cleanupGuildMessages(client, GUILD, { exported: exportCoverage(capture) });

    expect(deletedIds(channels)).toEqual(['mem-1', 'tc-open', 'ac-open']);
    expect(result.keptChannelIds).toEqual(['th-a', 'th-returning', 'tc-new', 'ac-locked']);
    expect(result.deleted).toBe(3);
    expect(result.failed).toBe(1);
  });

  // Bot messages found by the guild message search: one in a kept thread, one in an archive-forum
  // thread with no DB row (left by the old /archive cleanup), one in a normal channel.
  const sweepTargets = () => ({
    'th-orphan': makeChannel('th-orphan', ['orphaned transcript'], { parentId: 'forum-archive' }),
    general: makeChannel('general', ['announcement']),
  });
  const searchHits = [
    { id: 'th-a-m0', channel_id: 'th-a' },
    { id: 'th-orphan-m0', channel_id: 'th-orphan' },
    { id: 'general-m0', channel_id: 'general' },
  ];

  test('with an export, the bot-message sweep spares kept threads and every archive-forum thread', async () => {
    const channels = { ...seed(), ...sweepTargets() };
    repos.ArchivedTicketConfig = makeRepo([{ guildId: GUILD, channelId: 'forum-archive' }]);
    const client = makeClient(channels, { botId: 'bot', searchHits });
    const capture = await captureTranscripts(client, GUILD, ['th-returning', 'mem-1', 'tc-open', 'ac-open']);

    await cleanupGuildMessages(client, GUILD, { exported: exportCoverage(capture) });

    expect(channels.general.deletedMessageIds).toEqual(['general-m0']);
    expect(channels['th-a'].deletedMessageIds).toEqual([]); // kept: not in the export
    expect(channels['th-orphan'].deletedMessageIds).toEqual([]); // in no export, since it has no row
  });

  test('with an export, skips the sweep entirely if the threads to keep could not be listed', async () => {
    const channels = { ...seed(), ...sweepTargets() };
    repos.Ticket.find = async () => {
      throw new Error('database unavailable');
    };
    const client = makeClient(channels, { botId: 'bot', searchHits });

    const result = await cleanupGuildMessages(client, GUILD, { exported: { read: new Map(), gone: new Set() } });

    expect(Object.values(channels).flatMap(c => c.deletedMessageIds)).toEqual([]);
    expect(deletedIds(channels)).toEqual([]);
    expect(result.deleted).toBe(0);
  });
});
