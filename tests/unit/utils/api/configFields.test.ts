/**
 * applyFields unit tests — the descriptor-driven config field applier.
 * Covers each descriptor type, the patched[] return, range/enum validation,
 * null-clearing, and the "only present fields are touched" contract.
 */

import { describe, expect, test } from 'bun:test';
import { ApiError } from '../../../../src/utils/api/apiError';
import { applyFields, type FieldDescriptor } from '../../../../src/utils/api/configFields';

interface Cfg {
  enabled: boolean;
  count: number;
  retention: number;
  name: string;
  note: string | null;
  action: string;
}

function base(): Cfg {
  return { enabled: false, count: 0, retention: 90, name: 'old', note: 'keep', action: 'ban' };
}

const DESCRIPTORS: FieldDescriptor<Cfg>[] = [
  { field: 'enabled', type: 'bool' },
  { field: 'count', type: 'int' },
  { field: 'retention', type: 'int', min: 30, max: 365 },
  { field: 'name', type: 'string' },
  { field: 'note', type: 'nullableString' },
  { field: 'action', type: 'enum', values: ['ban', 'kick', 'timeout', 'log-only'] },
];

describe('applyFields', () => {
  test('applies only present fields and returns their names', () => {
    const cfg = base();
    const patched = applyFields(cfg, { enabled: true, count: 5 }, DESCRIPTORS);
    expect(cfg.enabled).toBe(true);
    expect(cfg.count).toBe(5);
    expect(cfg.name).toBe('old'); // absent → untouched
    expect(patched.sort()).toEqual(['count', 'enabled']);
  });

  test('absent body → nothing changed, empty patched', () => {
    const cfg = base();
    expect(applyFields(cfg, {}, DESCRIPTORS)).toEqual([]);
    expect(cfg).toEqual(base());
  });

  test('nullableString: null clears, "" normalizes to null, undefined leaves untouched', () => {
    const cfg = base();
    applyFields(cfg, { note: null }, DESCRIPTORS);
    expect(cfg.note).toBeNull();
    const cfg2 = base();
    applyFields(cfg2, { note: '' }, DESCRIPTORS); // optionalNullableString collapses '' → null
    expect(cfg2.note).toBeNull();
    const cfg3 = base();
    applyFields(cfg3, {}, DESCRIPTORS);
    expect(cfg3.note).toBe('keep');
  });

  test('int range: in-range applies, below min / above max throws ApiError', () => {
    const cfg = base();
    expect(applyFields(cfg, { retention: 30 }, DESCRIPTORS)).toEqual(['retention']);
    expect(cfg.retention).toBe(30);
    expect(() => applyFields(base(), { retention: 29 }, DESCRIPTORS)).toThrow(ApiError);
    expect(() => applyFields(base(), { retention: 366 }, DESCRIPTORS)).toThrow(ApiError);
  });

  test('plain int (no range) accepts any number', () => {
    const cfg = base();
    applyFields(cfg, { count: 999999 }, DESCRIPTORS);
    expect(cfg.count).toBe(999999);
  });

  test('enum: valid value applies, invalid throws', () => {
    const cfg = base();
    applyFields(cfg, { action: 'kick' }, DESCRIPTORS);
    expect(cfg.action).toBe('kick');
    expect(() => applyFields(base(), { action: 'nuke' }, DESCRIPTORS)).toThrow(ApiError);
  });

  test('string assigns and is tracked', () => {
    const cfg = base();
    expect(applyFields(cfg, { name: 'new' }, DESCRIPTORS)).toEqual(['name']);
    expect(cfg.name).toBe('new');
  });
});
