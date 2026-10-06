/**
 * `CheckContext`: everything a health check reads, loaded once per run.
 *
 * Checks are pure functions over this object, so tests build it from plain
 * objects and Maps (see `tests/helpers/fakeGuild.ts`) without a client or DB.
 */
import type { Guild, GuildMember } from 'discord.js';
import type { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { GuildPermission } from '../../typeorm/entities/GuildPermission';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../typeorm/entities/memory';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';
import { RulesConfig } from '../../typeorm/entities/rules';
import { SetupState } from '../../typeorm/entities/SetupState';
import { StaffRole } from '../../typeorm/entities/StaffRole';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { classifyRestError, type RefStatus } from './refs';

/** Guild-scoped entities checks can declare. Feature check modules add theirs here. */
export const HEALTH_ENTITIES = {
  BotConfig,
  GuildPermission,
  SetupState,
  StaffRole,
  // Moderation: ReactionRoleMenu loads its options eagerly (they have no guildId column).
  RulesConfig,
  ReactionRoleMenu,
  MemoryConfig,
  MemoryTag,
  MemoryItem,
};
export type HealthEntityName = keyof typeof HEALTH_ENTITIES;
export type HealthRow<K extends HealthEntityName> = InstanceType<(typeof HEALTH_ENTITIES)[K]>;

/** Loads every row of one entity for one guild. Injected in tests. */
export type RowLoader = (entity: HealthEntityName, guildId: string) => Promise<unknown[]>;

/** Only `find` is reachable, so the loader cannot write. */
export type ReadRepository = (target: EntityTarget<ObjectLiteral>) => Pick<Repository<ObjectLiteral>, 'find'>;

/** One guild-scoped `find` per entity. */
export function repoRowLoader(getRepository: ReadRepository): RowLoader {
  return (entity, guildId) => getRepository(HEALTH_ENTITIES[entity]).find({ where: { guildId } });
}

export const dbRowLoader: RowLoader = repoRowLoader(target => AppDataSource.getRepository(target));

/** Rows per entity. `null` means the load failed, which is never the same as "no rows". */
export type LoadedRows = Partial<Record<HealthEntityName, unknown[] | null>>;

export interface CheckContext {
  guildId: string;
  guild: Guild;
  me: GuildMember | null;
  deep: boolean;
  rest: RestFetcher;
  rows: LoadedRows;
}

export class HealthDataUnavailableError extends Error {}

/** Typed rows for an entity the check declared. Throws when the load failed, so the check reports an error. */
export function rowsOf<K extends HealthEntityName>(ctx: CheckContext, entity: K): HealthRow<K>[] {
  const rows = ctx.rows[entity];
  if (rows === undefined) throw new Error(`Health check read ${entity} without declaring it`);
  if (rows === null) throw new HealthDataUnavailableError(`${entity} rows could not be loaded`);
  return rows as HealthRow<K>[];
}

/** Loads each entity once, in parallel. A failed entity becomes `null` instead of failing the run. */
export async function loadRows(
  guildId: string,
  entities: Iterable<HealthEntityName>,
  loader: RowLoader = dbRowLoader,
): Promise<LoadedRows> {
  const unique = [...new Set(entities)];
  // async wrapper: a loader that throws synchronously still only fails its own entity.
  const results = await Promise.allSettled(unique.map(async entity => loader(entity, guildId)));
  const rows: LoadedRows = {};
  unique.forEach((entity, i) => {
    const result = results[i];
    if (result.status === 'fulfilled') {
      rows[entity] = result.value;
      return;
    }
    rows[entity] = null;
    enhancedLogger.warn(`Health check could not load ${entity}`, LogCategory.DATABASE, {
      guildId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Budgeted REST fetcher
// ---------------------------------------------------------------------------

export const HEALTH_REST_BUDGET = { concurrency: 4, timeoutMs: 5_000, maxCalls: 60 };

export type RestOutcome<T> = { status: 'ok'; value: T } | { status: Exclude<RefStatus, 'ok'> | 'skipped' };

export interface RestFetcher {
  /** Runs `call` inside the budget. A null result counts as missing (`RoleManager.fetch` returns null for Unknown Role). */
  fetch<T>(label: string, call: () => Promise<T | null | undefined>): Promise<RestOutcome<T>>;
  /** Labels of calls skipped because the budget ran out; the runner copies them into `notChecked`. */
  readonly skipped: string[];
}

export function createRestFetcher(budget = HEALTH_REST_BUDGET): RestFetcher {
  let started = 0;
  let active = 0;
  const waiting: (() => void)[] = [];
  const skipped: string[] = [];

  const acquire = (): Promise<void> => {
    if (active < budget.concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise(resolve => waiting.push(resolve));
  };
  // Hand the slot straight to the next waiter, so `active` never exceeds the cap.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return {
    skipped,
    async fetch<T>(label: string, call: () => Promise<T | null | undefined>): Promise<RestOutcome<T>> {
      if (started >= budget.maxCalls) {
        skipped.push(label);
        return { status: 'skipped' };
      }
      started++;
      await acquire();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${budget.timeoutMs}ms`)), budget.timeoutMs);
        });
        const value = await Promise.race([call(), timeout]);
        return value == null ? { status: 'missing' } : { status: 'ok', value };
      } catch (error) {
        return { status: classifyRestError(error) };
      } finally {
        clearTimeout(timer);
        release();
      }
    },
  };
}
