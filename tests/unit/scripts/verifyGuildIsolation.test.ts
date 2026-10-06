/**
 * verifyGuildIsolation script (NindroidA/cogworks-bot#41, finding #148).
 *
 * Before: it counted 6 hand-picked tables, its cross-guild check was a stub
 * that always passed, and it exited 0 even on failure. Now the queries come
 * from the entity metadata. These tests build the metadata without a
 * database connection and pin what gets checked.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { DataSource } from 'typeorm';
import { type IsolationQuery, isolationQueries } from '../../../scripts/verifyGuildIsolation';
import { AppDataSource } from '../../../src/typeorm';

let ds: DataSource;
let queries: IsolationQuery[];

beforeAll(async () => {
  ds = new DataSource({ type: 'mysql', database: 'metadata_only', entities: AppDataSource.options.entities as any });
  // Builds entity metadata without connecting (initialize() would connect first)
  await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  queries = isolationQueries(ds.entityMetadatas, name => `\`${name}\``);
});

describe('isolationQueries', () => {
  test('checks the guildId of every guild-scoped table', () => {
    const scoped = ds.entityMetadatas.filter(m => m.findColumnWithPropertyName('guildId')).map(m => m.tableName);
    expect(scoped.length).toBeGreaterThanOrEqual(44);
    expect(queries.filter(q => !q.label.includes('->')).map(q => q.label)).toEqual(scoped);
    expect(queries.find(q => q.label === 'xp_users')?.sql).toBe(
      "SELECT COUNT(*) AS n FROM `xp_users` WHERE `guildId` IS NULL OR `guildId` NOT REGEXP '^[0-9]{17,20}$'",
    );
  });

  test('checks memory items and tags point at a memory config of the same guild', () => {
    const refs = queries.filter(q => q.label.includes('->'));
    expect(refs.map(q => q.label)).toEqual(
      expect.arrayContaining(['memory_items.memoryConfigId -> memory_configs', 'memory_tags.memoryConfigId -> memory_configs']),
    );
    expect(refs[0].sql).toContain('p.`id` IS NULL OR p.`guildId` <> c.`guildId`');
  });

  test('skips tables without a guildId (bot_status, status_incidents, reaction_role_options)', () => {
    const labels = queries.map(q => q.label).join(' ');
    for (const table of ['bot_status', 'status_incidents', 'reaction_role_options']) expect(labels).not.toContain(table);
  });
});
