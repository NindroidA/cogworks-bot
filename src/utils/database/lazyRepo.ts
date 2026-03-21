import type { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { AppDataSource } from '../../typeorm';

/**
 * Creates a lazily-initialized repository proxy.
 *
 * Unlike `AppDataSource.getRepository(Entity)` at module scope, this defers
 * the actual repository lookup until the first property access. This avoids
 * boot-order crashes if a module is imported before `AppDataSource.initialize()`
 * has completed.
 *
 * Usage — drop-in replacement at module scope:
 * ```ts
 * // Before (eager — crashes if imported before DB init)
 * const ticketRepo = AppDataSource.getRepository(Ticket);
 *
 * // After (lazy — safe at module scope)
 * const ticketRepo = lazyRepo(Ticket);
 * ```
 */
export function lazyRepo<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
  let cached: Repository<T> | undefined;

  return new Proxy({} as Repository<T>, {
    get(_target, prop, _receiver) {
      cached ??= AppDataSource.getRepository(entity);
      const value = (cached as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function') {
        return (value as Function).bind(cached);
      }
      return value;
    },
  });
}
