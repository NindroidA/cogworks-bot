/**
 * Legacy Ticket Types Unit Tests
 *
 * Tests the pure helpers exported from legacyTypes.ts: type guards, the
 * canonical descriptor table, the display-info lookup, and the ping-column
 * resolver. The async `resolveTicketType` helper is covered by integration
 * tests that exercise the TypeORM layer.
 */

import { describe, expect, test } from '@jest/globals';
import type { LegacyTicketTypeId } from '../../../../src/utils/ticket/legacyTypes';
import {
  isLegacyTicketType,
  LEGACY_TICKET_TYPE_IDS,
  LEGACY_TYPES,
  legacyTypeInfo,
  resolveLegacyPingColumn,
} from '../../../../src/utils/ticket/legacyTypes';

const ALL_LEGACY_IDS: readonly string[] = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];

describe('Legacy Ticket Types', () => {
  describe('LEGACY_TICKET_TYPE_IDS', () => {
    test('contains exactly 5 legacy type IDs', () => {
      expect(LEGACY_TICKET_TYPE_IDS).toHaveLength(5);
    });

    test('contains all expected legacy IDs', () => {
      for (const id of ALL_LEGACY_IDS) {
        expect(LEGACY_TICKET_TYPE_IDS).toContain(id);
      }
    });
  });

  describe('LEGACY_TYPES descriptor table', () => {
    test('has one descriptor per legacy ID', () => {
      expect(LEGACY_TYPES).toHaveLength(LEGACY_TICKET_TYPE_IDS.length);
    });

    test('each descriptor has a non-empty displayName and emoji', () => {
      for (const descriptor of LEGACY_TYPES) {
        expect(typeof descriptor.displayName).toBe('string');
        expect(descriptor.displayName.length).toBeGreaterThan(0);
        expect(typeof descriptor.emoji).toBe('string');
        expect(descriptor.emoji.length).toBeGreaterThan(0);
      }
    });

    test('descriptor typeIds match LEGACY_TICKET_TYPE_IDS', () => {
      const descriptorIds = LEGACY_TYPES.map(d => d.typeId);
      expect(descriptorIds.sort()).toEqual([...LEGACY_TICKET_TYPE_IDS].sort());
    });

    test('each descriptor has a unique emoji', () => {
      const emojis = LEGACY_TYPES.map(d => d.emoji);
      expect(new Set(emojis).size).toBe(emojis.length);
    });
  });

  describe('isLegacyTicketType()', () => {
    test('returns true for all 5 legacy IDs', () => {
      for (const id of ALL_LEGACY_IDS) {
        expect(isLegacyTicketType(id)).toBe(true);
      }
    });

    test('returns false for random strings', () => {
      expect(isLegacyTicketType('random_string')).toBe(false);
      expect(isLegacyTicketType('custom-type-abc')).toBe(false);
      expect(isLegacyTicketType('ticket_type_1')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isLegacyTicketType('')).toBe(false);
    });

    test('returns false for custom type IDs (UUID-style)', () => {
      expect(isLegacyTicketType('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false);
      expect(isLegacyTicketType('custom_type_12345')).toBe(false);
    });

    test('returns false for close variations of legacy IDs', () => {
      expect(isLegacyTicketType('ban-appeal')).toBe(false);
      expect(isLegacyTicketType('Bug_Report')).toBe(false);
      expect(isLegacyTicketType('OTHER')).toBe(false);
      expect(isLegacyTicketType('18+verify')).toBe(false);
    });

    test('narrows type when used as type guard', () => {
      const typeId: string = 'ban_appeal';
      if (isLegacyTicketType(typeId)) {
        // TypeScript should narrow typeId to LegacyTicketTypeId here
        const info = legacyTypeInfo(typeId);
        expect(info).not.toBeNull();
      } else {
        fail('Expected isLegacyTicketType to return true for ban_appeal');
      }
    });
  });

  describe('legacyTypeInfo()', () => {
    test('returns a descriptor for every legacy ID', () => {
      for (const id of ALL_LEGACY_IDS) {
        const info = legacyTypeInfo(id);
        expect(info).not.toBeNull();
        expect(info?.typeId).toBe(id);
        expect(info?.displayName.length).toBeGreaterThan(0);
        expect(info?.emoji.length).toBeGreaterThan(0);
      }
    });

    test('returns null for non-legacy IDs', () => {
      expect(legacyTypeInfo('random_string')).toBeNull();
      expect(legacyTypeInfo('custom_type_123')).toBeNull();
      expect(legacyTypeInfo('')).toBeNull();
    });

    test('returns descriptive display names (different from short IDs)', () => {
      expect(legacyTypeInfo('18_verify')?.displayName).toBe('18+ Verification');
      expect(legacyTypeInfo('ban_appeal')?.displayName).toBe('Ban Appeal');
      expect(legacyTypeInfo('player_report')?.displayName).toBe('Player Report');
      expect(legacyTypeInfo('bug_report')?.displayName).toBe('Bug Report');
      expect(legacyTypeInfo('other')?.displayName).toBe('Other');
    });

    test('returned descriptor references the canonical LEGACY_TYPES table', () => {
      for (const id of ALL_LEGACY_IDS) {
        const info = legacyTypeInfo(id);
        const canonical = LEGACY_TYPES.find(d => d.typeId === id);
        expect(info).toBe(canonical);
      }
    });
  });

  describe('resolveLegacyPingColumn()', () => {
    const expectedColumns: Record<LegacyTicketTypeId, string> = {
      '18_verify': 'pingStaffOn18Verify',
      ban_appeal: 'pingStaffOnBanAppeal',
      player_report: 'pingStaffOnPlayerReport',
      bug_report: 'pingStaffOnBugReport',
      other: 'pingStaffOnOther',
    };

    test('maps each legacy ID to the expected TicketConfig column', () => {
      for (const id of ALL_LEGACY_IDS) {
        const column = resolveLegacyPingColumn(id);
        expect(column).toBe(expectedColumns[id as LegacyTicketTypeId]);
      }
    });

    test('returns null for non-legacy IDs', () => {
      expect(resolveLegacyPingColumn('custom_type_x')).toBeNull();
      expect(resolveLegacyPingColumn('')).toBeNull();
    });
  });
});
