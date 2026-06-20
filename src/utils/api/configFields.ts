/**
 * Descriptor-driven config field application (unification roadmap target #2).
 *
 * Internal-API config PATCH handlers repeatedly do the same thing: for each
 * optional body field, read it with the right type-helper, validate, assign it
 * onto the entity, and remember which fields changed (for the audit log). This
 * collapses that boilerplate into a declarative descriptor list + one call.
 *
 * It deliberately covers ONLY the per-field mechanics. Cross-field/conditional
 * validation (e.g. "enabling X requires Y to be https"), side effects (cache
 * invalidation, command refresh), persistence, and audit writes stay explicit
 * in the caller — `applyFields` mutates the entity in place and returns the
 * list of changed field names so the caller drives the rest.
 */

import { ApiError } from './apiError';
import { optionalBoolean, optionalNullableString, optionalNumber, optionalString } from './helpers';

export interface FieldDescriptor<T> {
  /** Entity field name (also the body key). */
  field: keyof T & string;
  /**
   * - `bool`           → optionalBoolean
   * - `int`            → optionalNumber (with optional `min`/`max` range check)
   * - `string`         → optionalString (NOT NULL columns; never assigns null)
   * - `nullableString` → optionalNullableString (null/"" clears the column)
   * - `enum`           → optionalString validated against `values`
   */
  type: 'bool' | 'int' | 'string' | 'nullableString' | 'enum';
  /** Inclusive minimum for `int`. */
  min?: number;
  /** Inclusive maximum for `int`. */
  max?: number;
  /** Allowed values for `enum`. */
  values?: readonly string[];
}

function rangeMessage(field: string, min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `${field} must be between ${min} and ${max}`;
  if (min !== undefined) return `${field} must be >= ${min}`;
  return `${field} must be <= ${max}`;
}

/**
 * Apply optional body fields onto `target` per the descriptors. Returns the
 * names of the fields that were present in `body` (and thus changed) — feed
 * this to the audit log / change-detection. Throws `ApiError.badRequest` on a
 * range violation (`int`) or an out-of-set value (`enum`).
 *
 * Only fields present in `body` are touched; absent fields are left as-is.
 */
export function applyFields<T extends object>(
  target: T,
  body: Record<string, unknown>,
  descriptors: FieldDescriptor<T>[],
): string[] {
  const patched: string[] = [];
  const record = target as unknown as Record<string, unknown>;

  for (const d of descriptors) {
    const { field, type } = d;
    switch (type) {
      case 'bool': {
        const v = optionalBoolean(body, field);
        if (v !== undefined) {
          record[field] = v;
          patched.push(field);
        }
        break;
      }
      case 'int': {
        const v = optionalNumber(body, field);
        if (v !== undefined) {
          if ((d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) {
            throw ApiError.badRequest(rangeMessage(field, d.min, d.max));
          }
          record[field] = v;
          patched.push(field);
        }
        break;
      }
      case 'string': {
        const v = optionalString(body, field);
        if (v !== undefined) {
          record[field] = v;
          patched.push(field);
        }
        break;
      }
      case 'nullableString': {
        // null/"" clears the column; undefined leaves it untouched.
        const v = optionalNullableString(body, field);
        if (v !== undefined) {
          record[field] = v;
          patched.push(field);
        }
        break;
      }
      case 'enum': {
        const v = optionalString(body, field);
        if (v !== undefined) {
          if (d.values && !d.values.includes(v)) {
            throw ApiError.badRequest(`${field} must be one of: ${d.values.join(', ')}`);
          }
          record[field] = v;
          patched.push(field);
        }
        break;
      }
    }
  }

  return patched;
}
