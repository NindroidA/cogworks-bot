/**
 * Builtin Ticket Types Unit Tests
 *
 * Tests the pure helpers exported from builtinTypes.ts: type guards, the
 * canonical descriptor table, the display-info lookup, and the ping-column
 * resolver. The async `resolveTicketType` helper is covered by integration
 * tests that exercise the TypeORM layer.
 */

import { describe, expect, test } from 'bun:test';
import type { BuiltinTicketTypeId } from '../../../../src/utils/ticket/builtinTypes';
import {
  isBuiltinTicketType,
  BUILTIN_TICKET_TYPE_IDS,
  BUILTIN_TYPES,
  builtinTypeInfo,
  resolveBuiltinPingColumn,
} from '../../../../src/utils/ticket/builtinTypes';

const ALL_BUILTIN_IDS: readonly string[] = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];

describe('Builtin Ticket Types', () => {
  describe('BUILTIN_TICKET_TYPE_IDS', () => {
    test('contains exactly 5 builtin type IDs', () => {
      expect(BUILTIN_TICKET_TYPE_IDS).toHaveLength(5);
    });

    test('contains all expected builtin IDs', () => {
      for (const id of ALL_BUILTIN_IDS) {
        expect(BUILTIN_TICKET_TYPE_IDS).toContain(id);
      }
    });
  });

  describe('BUILTIN_TYPES descriptor table', () => {
    test('has one descriptor per builtin ID', () => {
      expect(BUILTIN_TYPES).toHaveLength(BUILTIN_TICKET_TYPE_IDS.length);
    });

    test('each descriptor has a non-empty displayName and emoji', () => {
      for (const descriptor of BUILTIN_TYPES) {
        expect(typeof descriptor.displayName).toBe('string');
        expect(descriptor.displayName.length).toBeGreaterThan(0);
        expect(typeof descriptor.emoji).toBe('string');
        expect(descriptor.emoji.length).toBeGreaterThan(0);
      }
    });

    test('descriptor typeIds match BUILTIN_TICKET_TYPE_IDS', () => {
      const descriptorIds = BUILTIN_TYPES.map(d => d.typeId);
      expect(descriptorIds.sort()).toEqual([...BUILTIN_TICKET_TYPE_IDS].sort());
    });

    test('each descriptor has a unique emoji', () => {
      const emojis = BUILTIN_TYPES.map(d => d.emoji);
      expect(new Set(emojis).size).toBe(emojis.length);
    });
  });

  describe('isBuiltinTicketType()', () => {
    test('returns true for all 5 builtin IDs', () => {
      for (const id of ALL_BUILTIN_IDS) {
        expect(isBuiltinTicketType(id)).toBe(true);
      }
    });

    test('returns false for random strings', () => {
      expect(isBuiltinTicketType('random_string')).toBe(false);
      expect(isBuiltinTicketType('custom-type-abc')).toBe(false);
      expect(isBuiltinTicketType('ticket_type_1')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isBuiltinTicketType('')).toBe(false);
    });

    test('returns false for custom type IDs (UUID-style)', () => {
      expect(isBuiltinTicketType('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false);
      expect(isBuiltinTicketType('custom_type_12345')).toBe(false);
    });

    test('returns false for close variations of builtin IDs', () => {
      expect(isBuiltinTicketType('ban-appeal')).toBe(false);
      expect(isBuiltinTicketType('Bug_Report')).toBe(false);
      expect(isBuiltinTicketType('OTHER')).toBe(false);
      expect(isBuiltinTicketType('18+verify')).toBe(false);
    });

    test('narrows type when used as type guard', () => {
      const typeId: string = 'ban_appeal';
      if (isBuiltinTicketType(typeId)) {
        // TypeScript should narrow typeId to BuiltinTicketTypeId here
        const info = builtinTypeInfo(typeId);
        expect(info).not.toBeNull();
      } else {
        fail('Expected isBuiltinTicketType to return true for ban_appeal');
      }
    });
  });

  describe('builtinTypeInfo()', () => {
    test('returns a descriptor for every builtin ID', () => {
      for (const id of ALL_BUILTIN_IDS) {
        const info = builtinTypeInfo(id);
        expect(info).not.toBeNull();
        expect(info?.typeId).toBe(id);
        expect(info?.displayName.length).toBeGreaterThan(0);
        expect(info?.emoji.length).toBeGreaterThan(0);
      }
    });

    test('returns null for non-builtin IDs', () => {
      expect(builtinTypeInfo('random_string')).toBeNull();
      expect(builtinTypeInfo('custom_type_123')).toBeNull();
      expect(builtinTypeInfo('')).toBeNull();
    });

    test('returns descriptive display names (different from short IDs)', () => {
      expect(builtinTypeInfo('18_verify')?.displayName).toBe('18+ Verification');
      expect(builtinTypeInfo('ban_appeal')?.displayName).toBe('Ban Appeal');
      expect(builtinTypeInfo('player_report')?.displayName).toBe('Player Report');
      expect(builtinTypeInfo('bug_report')?.displayName).toBe('Bug Report');
      expect(builtinTypeInfo('other')?.displayName).toBe('Other');
    });

    test('returned descriptor references the canonical BUILTIN_TYPES table', () => {
      for (const id of ALL_BUILTIN_IDS) {
        const info = builtinTypeInfo(id);
        const canonical = BUILTIN_TYPES.find(d => d.typeId === id);
        expect(info).toBe(canonical);
      }
    });
  });

  describe('resolveBuiltinPingColumn()', () => {
    const expectedColumns: Record<BuiltinTicketTypeId, string> = {
      '18_verify': 'pingStaffOn18Verify',
      ban_appeal: 'pingStaffOnBanAppeal',
      player_report: 'pingStaffOnPlayerReport',
      bug_report: 'pingStaffOnBugReport',
      other: 'pingStaffOnOther',
    };

    test('maps each builtin ID to the expected TicketConfig column', () => {
      for (const id of ALL_BUILTIN_IDS) {
        const column = resolveBuiltinPingColumn(id);
        expect(column).toBe(expectedColumns[id as BuiltinTicketTypeId]);
      }
    });

    test('returns null for non-builtin IDs', () => {
      expect(resolveBuiltinPingColumn('custom_type_x')).toBeNull();
      expect(resolveBuiltinPingColumn('')).toBeNull();
    });
  });
});
