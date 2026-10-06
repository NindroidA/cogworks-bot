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
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import guildDelete from '../../../../src/events/guildDelete';
import { AppDataSource } from '../../../../src/typeorm';
import { deleteAllGuildData } from '../../../../src/utils/database/guildQueries';
import { invalidateBaitCaches } from '../../../../src/utils/offboarding/guildCaches';
import { EXPORT_ENTITIES } from '../../../../src/utils/offboarding/guildDataExport';
import { hasFeatureAccess } from '../../../../src/utils/validation/featurePermission';
import { type FakeRepo, GUILD, makeRepo, patchRepositories } from '../archive/fakeDiscord';

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
    expect(purged.has('GuildPermission')).toBe(true);
    expect(guildEntityNames().filter(n => !purged.has(n))).toEqual([]);
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
  test('/data-export includes every guild-scoped entity, and nothing global', () => {
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
