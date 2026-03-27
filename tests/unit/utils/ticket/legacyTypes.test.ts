/**
 * Legacy Ticket Types Unit Tests
 *
 * Tests the type guards, constants, and display info for the 5 hardcoded
 * legacy ticket types that predate custom ticket types.
 */

import { describe, expect, test } from '@jest/globals';
import {
    isLegacyTicketType,
    LEGACY_TICKET_TYPE_IDS,
    LEGACY_TYPE_INFO,
    LEGACY_TYPE_NAMES,
} from '../../../../src/utils/ticket/legacyTypes';
import type { LegacyTicketTypeId } from '../../../../src/utils/ticket/legacyTypes';

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
                const name: string = LEGACY_TYPE_NAMES[typeId];
                expect(name).toBeDefined();
            } else {
                // This branch should not execute for a legacy ID
                fail('Expected isLegacyTicketType to return true for ban_appeal');
            }
        });
    });

    describe('LEGACY_TYPE_NAMES', () => {
        test('has entries for all 5 legacy types', () => {
            const keys = Object.keys(LEGACY_TYPE_NAMES);
            expect(keys).toHaveLength(5);
            for (const id of ALL_LEGACY_IDS) {
                expect(LEGACY_TYPE_NAMES[id as LegacyTicketTypeId]).toBeDefined();
            }
        });

        test('all values are non-empty strings', () => {
            for (const id of ALL_LEGACY_IDS) {
                const name = LEGACY_TYPE_NAMES[id as LegacyTicketTypeId];
                expect(typeof name).toBe('string');
                expect(name.length).toBeGreaterThan(0);
            }
        });

        test('contains expected display names', () => {
            expect(LEGACY_TYPE_NAMES['18_verify']).toBe('18+ Verify');
            expect(LEGACY_TYPE_NAMES.ban_appeal).toBe('Ban Appeal');
            expect(LEGACY_TYPE_NAMES.player_report).toBe('Player Report');
            expect(LEGACY_TYPE_NAMES.bug_report).toBe('Bug Report');
            expect(LEGACY_TYPE_NAMES.other).toBe('Other');
        });
    });

    describe('LEGACY_TYPE_INFO', () => {
        test('has entries for all 5 legacy types', () => {
            const keys = Object.keys(LEGACY_TYPE_INFO);
            expect(keys).toHaveLength(5);
            for (const id of ALL_LEGACY_IDS) {
                expect(LEGACY_TYPE_INFO[id as LegacyTicketTypeId]).toBeDefined();
            }
        });

        test('each entry has display and emoji properties', () => {
            for (const id of ALL_LEGACY_IDS) {
                const info = LEGACY_TYPE_INFO[id as LegacyTicketTypeId];
                expect(info).toHaveProperty('display');
                expect(info).toHaveProperty('emoji');
                expect(typeof info.display).toBe('string');
                expect(typeof info.emoji).toBe('string');
                expect(info.display.length).toBeGreaterThan(0);
                expect(info.emoji.length).toBeGreaterThan(0);
            }
        });

        test('display names are descriptive (different from short type IDs)', () => {
            expect(LEGACY_TYPE_INFO['18_verify'].display).toBe('18+ Verification');
            expect(LEGACY_TYPE_INFO.ban_appeal.display).toBe('Ban Appeal');
            expect(LEGACY_TYPE_INFO.player_report.display).toBe('Player Report');
            expect(LEGACY_TYPE_INFO.bug_report.display).toBe('Bug Report');
            expect(LEGACY_TYPE_INFO.other.display).toBe('Other');
        });

        test('each type has a unique emoji', () => {
            const emojis = ALL_LEGACY_IDS.map(id => LEGACY_TYPE_INFO[id as LegacyTicketTypeId].emoji);
            const uniqueEmojis = new Set(emojis);
            expect(uniqueEmojis.size).toBe(emojis.length);
        });
    });
});
