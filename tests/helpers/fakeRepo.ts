/**
 * Shared hand-rolled TypeORM repository fake.
 *
 * Extracted from the `makeFakeRepo` copies in the channelDelete / roleDelete /
 * messageDelete suites (those still carry their own copies; migrating them is a
 * follow-up). Same row store and call-log names, plus `findBy`, `insert`,
 * `update` and `delete`, so read-only code can be checked for "no writes".
 *
 * One difference: the methods read `shouldThrowOn` from the returned object.
 * The per-suite copies spread their state into a new object, so setting
 * `repo.shouldThrowOn` after creation never reached the methods.
 *
 * Use it through dependency injection (or by patching
 * `AppDataSource.getRepository` in beforeAll and restoring it in afterAll).
 * Never `mock.module` the lazyRepo module: that races across files on bun.
 *
 * Criteria match by `===`, except `IsNull()`, which matches null and undefined
 * (TypeORM 1.1.1 throws on a raw null, so conditional writes use it).
 */

import { FindOperator } from 'typeorm';

export type FakeRepoMethod =
  | 'findOne'
  | 'findOneBy'
  | 'findBy'
  | 'find'
  | 'count'
  | 'save'
  | 'remove'
  | 'insert'
  | 'update'
  | 'delete'
  | 'getMany';

export const WRITE_METHODS = ['save', 'remove', 'insert', 'update', 'delete'] as const;

export interface FakeRepo {
  rows: Map<string, any>;
  calls: Record<FakeRepoMethod, any[]>;
  findOneByCalls: any[];
  findCalls: any[];
  countCalls: any[];
  saveCalls: any[];
  removeCalls: any[];
  qbCalls: any[];
  shouldThrowOn?: FakeRepoMethod;
  /** Honors `where` only; `lock` and the other options are recorded in `calls.findOne`. */
  findOne(opts: any): Promise<any>;
  findOneBy(where: any): Promise<any>;
  findBy(where: any): Promise<any[]>;
  find(opts?: any): Promise<any[]>;
  count(opts?: any): Promise<number>;
  save(entity: any): Promise<any>;
  remove(entity: any): Promise<any>;
  insert(values: any): Promise<any>;
  update(criteria: any, partial: any): Promise<any>;
  delete(criteria: any): Promise<any>;
  createQueryBuilder(alias: string): any;
}

function matches(row: any, where: any): boolean {
  if (where === undefined || where === null) return true;
  if (typeof where !== 'object') return String(row.id) === String(where);
  return Object.entries(where).every(([k, v]) =>
    v instanceof FindOperator && v.type === 'isNull' ? row[k] == null : row[k] === v,
  );
}

export function makeFakeRepo(initialRows: any[] = []): FakeRepo {
  const calls = Object.fromEntries(
    (
      [
        'findOne',
        'findOneBy',
        'findBy',
        'find',
        'count',
        'save',
        'remove',
        'insert',
        'update',
        'delete',
        'getMany',
      ] as const
    ).map(m => [m, [] as any[]]),
  ) as Record<FakeRepoMethod, any[]>;

  const repo: FakeRepo = {
    rows: new Map(initialRows.map((r, i) => [String(r.id ?? i), r])),
    calls,
    findOneByCalls: calls.findOneBy,
    findCalls: calls.find,
    countCalls: calls.count,
    saveCalls: calls.save,
    removeCalls: calls.remove,
    qbCalls: calls.getMany,

    async findOne(opts) {
      record('findOne', opts);
      return [...repo.rows.values()].find(row => matches(row, opts?.where)) ?? null;
    },
    async findOneBy(where) {
      record('findOneBy', where);
      return [...repo.rows.values()].find(row => matches(row, where)) ?? null;
    },
    async findBy(where) {
      record('findBy', where);
      return [...repo.rows.values()].filter(row => matches(row, where));
    },
    async find(opts) {
      record('find', opts);
      return [...repo.rows.values()].filter(row => matches(row, opts?.where));
    },
    async count(opts) {
      record('count', opts);
      return [...repo.rows.values()].filter(row => matches(row, opts?.where)).length;
    },
    async save(entity) {
      record('save', { ...entity });
      repo.rows.set(String(entity.id ?? repo.rows.size), entity);
      return entity;
    },
    async remove(entity) {
      record('remove', Array.isArray(entity) ? [...entity] : { ...entity });
      for (const t of Array.isArray(entity) ? entity : [entity]) repo.rows.delete(String(t.id));
      return entity;
    },
    async insert(values) {
      record('insert', values);
      for (const v of Array.isArray(values) ? values : [values]) repo.rows.set(String(v.id ?? repo.rows.size), v);
      return { identifiers: [] };
    },
    async update(criteria, partial) {
      record('update', { criteria, partial });
      let affected = 0;
      for (const row of repo.rows.values()) {
        if (!matches(row, criteria)) continue;
        Object.assign(row, partial);
        affected++;
      }
      return { affected };
    },
    async delete(criteria) {
      record('delete', criteria);
      let affected = 0;
      for (const [key, row] of repo.rows) {
        if (!matches(row, criteria)) continue;
        repo.rows.delete(key);
        affected++;
      }
      return { affected };
    },
    createQueryBuilder(alias: string) {
      const params: Record<string, any> = {};
      const builder: any = {
        innerJoin: () => builder,
        leftJoin: () => builder,
        where: (_clause: string, p?: Record<string, any>) => {
          Object.assign(params, p ?? {});
          return builder;
        },
        andWhere: (_clause: string, p?: Record<string, any>) => {
          Object.assign(params, p ?? {});
          return builder;
        },
        async getMany() {
          record('getMany', { alias, params: { ...params } });
          return [...repo.rows.values()].filter(row => matches(row, params));
        },
      };
      return builder;
    },
  };

  function record(method: FakeRepoMethod, args: any) {
    calls[method].push(args);
    if (repo.shouldThrowOn === method) throw new Error(`boom-${method}`);
  }

  return repo;
}

/** Number of write calls (save/remove/insert/update/delete) a repo received. */
export function writeCallCount(repo: FakeRepo): number {
  return WRITE_METHODS.reduce((sum, m) => sum + repo.calls[m].length, 0);
}
