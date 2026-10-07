import { createHash } from 'node:crypto';
import type { HealthFinding } from '../types';

/**
 * A finding's id that stays the same across re-checks while the problem does:
 * the first 16 hex characters of sha1 over its code, target and sorted params.
 * The preview's selection is a list of these, re-planned against a fresh check.
 */
export function findingKey(f: HealthFinding): string {
  const params = Object.keys(f.params)
    .sort()
    .map(name => [name, f.params[name]]);
  const parts = [f.code, f.entity, f.rowId ?? '', f.field ?? '', f.refId ?? '', JSON.stringify(params)];
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}
