/**
 * Verified Delete Utilities Unit Tests
 *
 * Tests the exports and pure functions from the verified deletion module.
 * The async deletion functions require real Discord objects, so we focus on:
 * - Module exports are correctly exposed
 * - buildErrorMessage() pure function behavior
 * - BUG_REPORT_MESSAGE constant
 */

import { describe, expect, test } from '@jest/globals';
import {
    buildErrorMessage,
    BUG_REPORT_MESSAGE,
    verifiedChannelDelete,
    verifiedMessageDelete,
    verifiedMessageDeleteById,
    verifiedThreadDelete,
} from '../../../../src/utils/discord/verifiedDelete';
import type { DeleteResult } from '../../../../src/utils/discord/verifiedDelete';

describe('Verified Delete Utilities', () => {
    describe('module exports', () => {
        test('verifiedChannelDelete is exported and is a function', () => {
            expect(verifiedChannelDelete).toBeDefined();
            expect(typeof verifiedChannelDelete).toBe('function');
        });

        test('verifiedThreadDelete is exported and is a function', () => {
            expect(verifiedThreadDelete).toBeDefined();
            expect(typeof verifiedThreadDelete).toBe('function');
        });

        test('verifiedMessageDelete is exported and is a function', () => {
            expect(verifiedMessageDelete).toBeDefined();
            expect(typeof verifiedMessageDelete).toBe('function');
        });

        test('verifiedMessageDeleteById is exported and is a function', () => {
            expect(verifiedMessageDeleteById).toBeDefined();
            expect(typeof verifiedMessageDeleteById).toBe('function');
        });

        test('buildErrorMessage is exported and is a function', () => {
            expect(buildErrorMessage).toBeDefined();
            expect(typeof buildErrorMessage).toBe('function');
        });

        test('BUG_REPORT_MESSAGE is exported and is a string', () => {
            expect(BUG_REPORT_MESSAGE).toBeDefined();
            expect(typeof BUG_REPORT_MESSAGE).toBe('string');
        });
    });

    describe('BUG_REPORT_MESSAGE', () => {
        test('contains a Discord invite link', () => {
            expect(BUG_REPORT_MESSAGE).toContain('discord.gg');
        });

        test('contains the word "report"', () => {
            expect(BUG_REPORT_MESSAGE.toLowerCase()).toContain('report');
        });

        test('contains a markdown link', () => {
            // Should have [text](url) markdown link format
            expect(BUG_REPORT_MESSAGE).toMatch(/\[.*\]\(.*\)/);
        });
    });

    describe('buildErrorMessage()', () => {
        test('returns a string containing the input message', () => {
            const result = buildErrorMessage('Something went wrong.');
            expect(result).toContain('Something went wrong.');
        });

        test('appends the bug report link by default', () => {
            const result = buildErrorMessage('Failed to delete the channel.');
            expect(result).toContain(BUG_REPORT_MESSAGE);
            expect(result).toContain('discord.gg');
        });

        test('result starts with the user message', () => {
            const msg = 'An error occurred.';
            const result = buildErrorMessage(msg);
            expect(result.startsWith(msg)).toBe(true);
        });

        test('does not append bug report link when includeBugReport is false', () => {
            const result = buildErrorMessage('Something went wrong.', false);
            expect(result).toBe('Something went wrong.');
            expect(result).not.toContain(BUG_REPORT_MESSAGE);
        });

        test('includes bug report link when includeBugReport is explicitly true', () => {
            const result = buildErrorMessage('Error occurred.', true);
            expect(result).toContain(BUG_REPORT_MESSAGE);
        });

        test('handles empty string input', () => {
            const result = buildErrorMessage('');
            expect(result).toContain(BUG_REPORT_MESSAGE);
            expect(result).toBe(BUG_REPORT_MESSAGE);
        });

        test('handles long input messages', () => {
            const longMsg = 'A'.repeat(2000);
            const result = buildErrorMessage(longMsg);
            expect(result).toContain(longMsg);
            expect(result).toContain(BUG_REPORT_MESSAGE);
            expect(result.length).toBe(longMsg.length + BUG_REPORT_MESSAGE.length);
        });
    });

    describe('DeleteResult type shape', () => {
        test('a success result matches the interface', () => {
            const result: DeleteResult = {
                success: true,
                alreadyGone: false,
            };
            expect(result.success).toBe(true);
            expect(result.alreadyGone).toBe(false);
            expect(result.error).toBeUndefined();
        });

        test('an already-gone result matches the interface', () => {
            const result: DeleteResult = {
                success: true,
                alreadyGone: true,
            };
            expect(result.success).toBe(true);
            expect(result.alreadyGone).toBe(true);
        });

        test('a failure result with error matches the interface', () => {
            const result: DeleteResult = {
                success: false,
                alreadyGone: false,
                error: 'Missing Permissions',
            };
            expect(result.success).toBe(false);
            expect(result.error).toBe('Missing Permissions');
        });
    });
});
