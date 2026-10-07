/**
 * Repair writes. Each one only lands while the row still holds the values the
 * plan saw (its guard): a row someone changed since the check is left alone
 * (`stale`), and a row deleted since then is reported `gone`.
 *
 * - Scalar guards: one conditional UPDATE or DELETE on `{ ...guard, ...where }`,
 *   with null as `IsNull()` (TypeORM 1.1.1 throws on null criteria). When it
 *   affects nothing, an existence read tells stale from gone.
 * - JSON guards (lists, maps), cascades and reaction-role options: one
 *   transaction that locks the row (SELECT … FOR UPDATE), compares the guard
 *   with `isDeepStrictEqual`, then writes. A cascade deletes the children
 *   first, and anything unexpected rolls the whole write back.
 *
 * Every where must carry the guild's id, and every set and delete a non-empty
 * guard (and a set a non-empty set), or the store throws before writing.
 */
import { isDeepStrictEqual } from 'node:util';
import { type EntityTarget, IsNull, type ObjectLiteral } from 'typeorm';
import type { RefCascade, RefEntityName } from '../../cleanup/refPatches';

type Row = Record<string, unknown>;
type Where = Record<string, string | number>;
type WriteResult = { affected?: number | null } | undefined;

export type StoreOutcome = 'applied' | 'stale' | 'gone' | 'exists';

/** The slice of a TypeORM repository the store uses. */
export interface StoreRepo {
  findOne(options: {
    where: Row;
    lock?: { mode: 'pessimistic_write' };
    loadEagerRelations?: boolean;
  }): Promise<Row | null>;
  count(options: { where: Row }): Promise<number>;
  update(criteria: Row, partial: Row): Promise<WriteResult>;
  delete(criteria: Row): Promise<WriteResult>;
  insert(values: Row): Promise<unknown>;
}

export interface RepairDb {
  repo(entity: RefEntityName): StoreRepo;
  /** Runs `work` in one transaction; a throw rolls it back. */
  transaction<T>(work: (tx: Pick<RepairDb, 'repo'>) => Promise<T>): Promise<T>;
}

export interface RepairStore {
  set(entity: RefEntityName, where: Where, guard: Row, set: Row): Promise<StoreOutcome>;
  delete(entity: RefEntityName, where: Where, guard: Row, cascade?: readonly RefCascade[]): Promise<StoreOutcome>;
  /** Insert-ignore: `exists` when the unique key is already taken. */
  insert(entity: RefEntityName, values: Row): Promise<StoreOutcome>;
}

/** Entities without a guildId column: the row must belong to a parent row of the guild. */
const OWNED_BY: Partial<Record<RefEntityName, { entity: RefEntityName; column: string }>> = {
  ReactionRoleOption: { entity: 'ReactionRoleMenu', column: 'menuId' },
};

const LOCK = { mode: 'pessimistic_write' } as const;

/** Thrown inside a transaction when a write under the lock affected nothing; it rolls the transaction back. */
class StaleWrite extends Error {}

function guildOf(where: Row): string {
  const { guildId } = where;
  if (typeof guildId !== 'string' || guildId === '') throw new Error('Repair writes must be scoped by guildId');
  return guildId;
}

/** An empty guard would make the write unconditional, and an empty set has nothing to write. */
function requireValues(kind: string, values: Row): void {
  if (Object.keys(values).length === 0) throw new Error(`Repair writes need a non-empty ${kind}`);
}

const isScalar = (value: unknown) => value === null || typeof value !== 'object';
const affectedNothing = (result: WriteResult) => result?.affected === 0;
/** The guard as criteria: null (or undefined) must be `IsNull()`. */
const asCriteria = (guard: Row) => Object.fromEntries(Object.entries(guard).map(([k, v]) => [k, v ?? IsNull()]));
const guardHolds = (row: Row, guard: Row) =>
  Object.entries(guard).every(([k, v]) => isDeepStrictEqual(row[k] ?? null, v ?? null));

/** One conditional statement; `where` goes last so no guard field can widen it. */
async function conditional(
  repo: StoreRepo,
  where: Where,
  guard: Row,
  write: (criteria: Row) => Promise<WriteResult>,
): Promise<StoreOutcome> {
  if (!affectedNothing(await write({ ...asCriteria(guard), ...where }))) return 'applied';
  return (await repo.count({ where })) > 0 ? 'stale' : 'gone';
}

/** Locks the row (and an owned row's parent), checks the guard, then runs `write` in the same transaction. */
async function locked(
  db: RepairDb,
  entity: RefEntityName,
  where: Where,
  guard: Row,
  write: (tx: Pick<RepairDb, 'repo'>, rowWhere: Row) => Promise<void>,
): Promise<StoreOutcome> {
  const owner = OWNED_BY[entity];
  try {
    return await db.transaction(async tx => {
      let rowWhere: Row = where;
      if (owner) {
        const { guildId, ...own } = where;
        const parentId = where[owner.column];
        if (parentId === undefined) throw new Error(`${entity} repair needs ${owner.column} in its where`);
        const parent = await tx
          .repo(owner.entity)
          .findOne({ where: { id: parentId, guildId }, lock: LOCK, loadEagerRelations: false });
        // Another guild's parent reads the same as a deleted one: nothing of this guild's to write.
        if (!parent) return 'gone';
        rowWhere = own;
      }
      const row = await tx.repo(entity).findOne({ where: rowWhere, lock: LOCK, loadEagerRelations: false });
      if (!row) return 'gone';
      if (!guardHolds(row, guard)) return 'stale';
      await write(tx, rowWhere);
      return 'applied';
    });
  } catch (error) {
    if (error instanceof StaleWrite) return 'stale';
    throw error;
  }
}

export function createRepairStore(db: RepairDb): RepairStore {
  const needsLock = (entity: RefEntityName, guard: Row, cascade?: readonly RefCascade[]) =>
    Boolean(OWNED_BY[entity] || cascade?.length || !Object.values(guard).every(isScalar));

  return {
    async set(entity, where, guard, set) {
      guildOf(where);
      requireValues('guard', guard);
      requireValues('set', set);
      if (!needsLock(entity, guard)) {
        return conditional(db.repo(entity), where, guard, criteria => db.repo(entity).update(criteria, set));
      }
      return locked(db, entity, where, guard, async (tx, rowWhere) => {
        if (affectedNothing(await tx.repo(entity).update(rowWhere, set))) throw new StaleWrite();
      });
    },

    async delete(entity, where, guard, cascade) {
      const guildId = guildOf(where);
      requireValues('guard', guard);
      for (const child of cascade ?? []) {
        // An owned child is only scoped through its own parent, so it may only cascade from that parent.
        const owner = OWNED_BY[child.entity];
        if (owner && owner.entity !== entity) throw new Error(`${child.entity} rows can't cascade from ${entity}`);
      }
      if (!needsLock(entity, guard, cascade)) {
        return conditional(db.repo(entity), where, guard, criteria => db.repo(entity).delete(criteria));
      }
      return locked(db, entity, where, guard, async (tx, rowWhere) => {
        for (const child of cascade ?? []) {
          // An owned child (a menu's options) is scoped through the parent locked above.
          const scope = OWNED_BY[child.entity] ? {} : { guildId };
          await tx.repo(child.entity).delete({ ...scope, [child.column]: where.id });
        }
        if (affectedNothing(await tx.repo(entity).delete(rowWhere))) throw new StaleWrite();
      });
    },

    async insert(entity, values) {
      guildOf(values);
      try {
        await db.repo(entity).insert(values);
        return 'applied';
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'ER_DUP_ENTRY') return 'exists';
        throw error;
      }
    },
  };
}

/** The production database. Loaded on first use, so importing the store never touches the DataSource. */
export async function appRepairDb(): Promise<RepairDb> {
  const [{ AppDataSource }, { HEALTH_ENTITIES }, { ReactionRoleOption }] = await Promise.all([
    import('../../../typeorm'),
    import('../context'),
    import('../../../typeorm/entities/reactionRole/ReactionRoleOption'),
  ]);
  const targets: Record<RefEntityName, EntityTarget<ObjectLiteral>> = { ...HEALTH_ENTITIES, ReactionRoleOption };
  type Manager = { getRepository(target: EntityTarget<ObjectLiteral>): unknown };
  const reposOf = (manager: Manager) => ({
    repo: (entity: RefEntityName) => manager.getRepository(targets[entity]) as StoreRepo,
  });
  return { ...reposOf(AppDataSource), transaction: work => AppDataSource.transaction(m => work(reposOf(m))) };
}
