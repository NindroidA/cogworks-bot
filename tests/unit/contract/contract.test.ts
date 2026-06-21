/**
 * cogworks-contract.json structure tests.
 *
 * Validates the committed contract artifact (what ninsys-api + the webapp
 * codegen from). The generator's correctness is guarded separately by the
 * `check:contract` CI drift gate; these lock the shape consumers depend on,
 * including the actionType-enum tie-in from the Phase 0 fix.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const contract = JSON.parse(readFileSync(join(process.cwd(), 'contract', 'cogworks-contract.json'), 'utf8'));

describe('cogworks-contract.json', () => {
  test('has the expected top-level shape', () => {
    expect(contract.contractVersion).toBe('1');
    expect(typeof contract.botVersion).toBe('string');
    expect(Array.isArray(contract.commands)).toBe(true);
    expect(contract.commands.length).toBeGreaterThan(0);
  });

  test('carries the full feature + level catalog', () => {
    expect(contract.features.keys).toContain('baitchannel');
    expect(contract.features.keys.length).toBe(13);
    expect(contract.features.levels).toEqual(['use', 'manage', 'admin']);
  });

  test('exposes the bait config schema with actionType as an enum of the bot action set', () => {
    const fields = contract.configSchemas.baitChannel.fields as Array<{ field: string; type: string; values?: string[] }>;
    expect(Array.isArray(fields)).toBe(true);
    const actionType = fields.find(f => f.field === 'actionType');
    expect(actionType?.type).toBe('enum');
    expect(actionType?.values).toEqual(['ban', 'kick', 'timeout', 'log-only']);
  });

  test('every command entry is registered command JSON (has a name)', () => {
    expect(contract.commands.every((c: { name?: string }) => typeof c.name === 'string')).toBe(true);
  });
});
