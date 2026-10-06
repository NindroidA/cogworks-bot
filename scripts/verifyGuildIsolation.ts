/**
 * Guild data isolation check. Read-only, safe to run against production.
 *
 * For every entity with a guildId column (read from the DataSource metadata,
 * so new entities are covered without editing this file) it counts rows whose
 * guildId is missing or not a snowflake. For every id column that points at
 * another guild-scoped table it counts rows pointing at a missing row or at
 * another guild's row. Exits 1 when it finds anything or a query fails.
 *
 * Usage: bun run verify:isolation   (reads the MYSQL_DB_* env)
 *
 * Not covered: channel and role ids stored in configs. Checking those needs
 * the Discord cache; the health-check engine (src/utils/health) does it per guild.
 */

import { DataSource, type DataSourceOptions, type EntityMetadata } from 'typeorm';
import { AppDataSource } from '../src/typeorm';

/** Id columns that point at another guild-scoped table without a declared TypeORM relation. */
const UNDECLARED_REFS = [
  { entity: 'MemoryItem', column: 'memoryConfigId', target: 'MemoryConfig' },
  { entity: 'MemoryTag', column: 'memoryConfigId', target: 'MemoryConfig' },
];

export interface IsolationQuery {
  label: string;
  problem: string;
  sql: string;
}

const guildColumn = (meta: EntityMetadata) => meta.findColumnWithPropertyName('guildId')?.databaseName;

/** One COUNT query per guild-scoped table and per id reference between two guild-scoped tables. */
export function isolationQueries(metas: EntityMetadata[], escape: (name: string) => string): IsolationQuery[] {
  const scoped = metas.filter(meta => guildColumn(meta));
  const queries: IsolationQuery[] = scoped.map(meta => {
    const g = escape(guildColumn(meta)!);
    return {
      label: meta.tableName,
      problem: 'rows with a missing or malformed guildId',
      sql: `SELECT COUNT(*) AS n FROM ${escape(meta.tableName)} WHERE ${g} IS NULL OR ${g} NOT REGEXP '^[0-9]{17,20}$'`,
    };
  });

  const refs = scoped.flatMap(from =>
    from.manyToOneRelations
      .filter(rel => guildColumn(rel.inverseEntityMetadata) && rel.joinColumns.length === 1)
      .map(rel => ({ from, column: rel.joinColumns[0].databaseName, to: rel.inverseEntityMetadata })),
  );
  for (const ref of UNDECLARED_REFS) {
    const from = metas.find(meta => meta.name === ref.entity);
    const to = metas.find(meta => meta.name === ref.target);
    const column = from?.findColumnWithPropertyName(ref.column)?.databaseName;
    if (!from || !to || !column) throw new Error(`Stale UNDECLARED_REFS entry: ${ref.entity}.${ref.column}`);
    refs.push({ from, column, to });
  }

  for (const { from, column, to } of refs) {
    const [c, pk] = [escape(column), escape(to.primaryColumns[0].databaseName)];
    queries.push({
      label: `${from.tableName}.${column} -> ${to.tableName}`,
      problem: "rows pointing at a missing row or another guild's row",
      sql:
        `SELECT COUNT(*) AS n FROM ${escape(from.tableName)} c LEFT JOIN ${escape(to.tableName)} p ON p.${pk} = c.${c} ` +
        `WHERE c.${c} IS NOT NULL AND (p.${pk} IS NULL OR p.${escape(guildColumn(to)!)} <> c.${escape(guildColumn(from)!)})`,
    });
  }
  return queries;
}

async function main(): Promise<number> {
  // Same connection settings as the bot, but a check never synchronizes or runs migrations.
  const ds = new DataSource({ ...AppDataSource.options, synchronize: false, migrationsRun: false } as DataSourceOptions);
  await ds.initialize();
  let problems = 0;
  try {
    const queries = isolationQueries(ds.entityMetadatas, name => ds.driver.escape(name));
    console.log(`Running ${queries.length} isolation checks\n`);
    for (const { label, problem, sql } of queries) {
      const count = Number((await ds.query(sql))[0]?.n ?? 0);
      console.log(count > 0 ? `FAIL ${label}: ${count} ${problem}` : `ok   ${label}`);
      problems += count;
    }
  } finally {
    await ds.destroy();
  }
  console.log(problems === 0 ? '\nNo isolation problems found.' : `\n${problems} problem rows found.`);
  return problems === 0 ? 0 : 1;
}

// argv check instead of import.meta.main (see checkChangelog.ts): importing for tests must not connect.
if (process.argv[1]?.endsWith('/verifyGuildIsolation.ts')) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error('Isolation check failed:', error);
      process.exitCode = 1;
    },
  );
}
