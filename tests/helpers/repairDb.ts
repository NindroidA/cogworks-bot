/**
 * A fake `RepairDb` over `makeFakeRepo` tables, for the repair store and the
 * repair round trips. The fake transaction snapshots every table and restores
 * it on a throw, like a database rollback, and `log` records each write with
 * whether it ran inside the transaction.
 */
import { createRepairStore, type RepairDb } from '../../src/utils/health/repair/store';
import type { RepairEntityName } from '../../src/utils/health/repair/types';
import { type FakeRepo, makeFakeRepo } from './fakeRepo';

export function makeRepairDb(tables: Partial<Record<RepairEntityName, any[]>>) {
  const repos = new Map<RepairEntityName, FakeRepo>();
  const log: string[] = [];
  let depth = 0;
  let transactions = 0;
  const repo = (entity: RepairEntityName) => {
    let fake = repos.get(entity);
    if (!fake) {
      fake = makeFakeRepo();
      repos.set(entity, fake);
      for (const method of ['update', 'delete', 'insert'] as const) {
        const inner = fake[method] as (...args: any[]) => Promise<any>;
        (fake as any)[method] = (...args: any[]) => {
          log.push(`${depth > 0 ? 'tx ' : ''}${method} ${entity}`);
          return inner(...args);
        };
      }
    }
    return fake;
  };
  for (const [entity, rows] of Object.entries(tables)) {
    const fake = repo(entity as RepairEntityName);
    for (const row of rows ?? []) fake.rows.set(String(row.id ?? row.guildId), row);
  }
  const db: RepairDb = {
    repo,
    async transaction(work) {
      transactions++;
      const snapshot = [...repos.values()].map(fake => [fake, structuredClone(fake.rows)] as const);
      depth++;
      try {
        return await work({ repo });
      } catch (error) {
        for (const [fake, rows] of snapshot) fake.rows = rows;
        throw error;
      } finally {
        depth--;
      }
    },
  };
  const ids = (entity: RepairEntityName) => [...repo(entity).rows.values()].map(row => row.id);
  return { db, store: createRepairStore(db), repo, log, ids, transactions: () => transactions };
}
