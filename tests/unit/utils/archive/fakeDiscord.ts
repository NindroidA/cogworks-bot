/**
 * Hand-rolled repository fakes shared by the export and purge tests
 * (/data-export, deleteAllGuildData).
 */

export const GUILD = '100000000000000001';

/** Values of a TypeORM `In([...])` / `Not(x)` operator, or the plain value. */
function operatorValue(value: any): any {
  return value && typeof value === 'object' && '_type' in value ? value._value : value;
}

function matches(row: Record<string, any>, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '_type' in expected) {
      if (expected._type === 'in') return (expected._value as unknown[]).includes(row[key]);
      if (expected._type === 'not') {
        const inner = operatorValue(expected._value);
        return inner && typeof inner === 'object' && inner._type === 'isNull' ? row[key] != null : row[key] !== inner;
      }
      return true;
    }
    return row[key] === expected;
  });
}

export interface FakeRepo {
  rows: Record<string, any>[];
  deletedWhere: Record<string, any>[];
  find: (opts?: { where?: Record<string, any> }) => Promise<any[]>;
  findOneBy: (where: Record<string, any>) => Promise<any | null>;
  delete: (where: Record<string, any>) => Promise<{ affected: number }>;
}

/** In-memory repository understanding the where-clauses these flows use (equality, In, Not, Not(IsNull)). */
export function makeRepo(rows: Record<string, any>[] = []): FakeRepo {
  const repo: FakeRepo = {
    rows,
    deletedWhere: [],
    find: async opts => repo.rows.filter(r => matches(r, opts?.where)),
    findOneBy: async where => repo.rows.find(r => matches(r, where)) ?? null,
    delete: async where => {
      repo.deletedWhere.push(where);
      const before = repo.rows.length;
      repo.rows = repo.rows.filter(r => !matches(r, where));
      return { affected: before - repo.rows.length };
    },
  };
  return repo;
}

type GetRepository = (entity: any) => unknown;

/** Route AppDataSource.getRepository by entity class name; returns a restore function. */
export async function patchRepositories(repos: () => Record<string, FakeRepo>): Promise<() => void> {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: GetRepository };
  const original = ds.getRepository;
  ds.getRepository = (entity: any) => repos()[entity?.name] ?? makeRepo();
  return () => {
    ds.getRepository = original;
  };
}
