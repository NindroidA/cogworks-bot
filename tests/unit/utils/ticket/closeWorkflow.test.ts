/**
 * Close Workflow Unit Tests
 *
 * Tests the module exports and types for the shared ticket close workflow.
 * Since archiveAndCloseTicket requires a Discord client and database connection,
 * we verify the module structure rather than running the full workflow.
 */

import { describe, expect, test } from '@jest/globals';
import { archiveAndCloseTicket } from '../../../../src/utils/ticket/closeWorkflow';
import type { ArchiveTicketResult } from '../../../../src/utils/ticket/closeWorkflow';

describe('Close Workflow', () => {
    describe('module exports', () => {
        test('archiveAndCloseTicket is exported and is a function', () => {
            expect(archiveAndCloseTicket).toBeDefined();
            expect(typeof archiveAndCloseTicket).toBe('function');
        });

        test('archiveAndCloseTicket is an async function', () => {
            // Async functions have the AsyncFunction constructor
            const AsyncFunction = (async () => {}).constructor;
            expect(archiveAndCloseTicket).toBeInstanceOf(AsyncFunction);
        });
    });

    describe('ArchiveTicketResult type shape', () => {
        test('a minimal success result satisfies the interface', () => {
            const result: ArchiveTicketResult = {
                success: true,
                archived: true,
            };
            expect(result.success).toBe(true);
            expect(result.archived).toBe(true);
            expect(result.postId).toBeUndefined();
            expect(result.transcriptFailed).toBeUndefined();
            expect(result.error).toBeUndefined();
        });

        test('a failure result with all optional fields satisfies the interface', () => {
            const result: ArchiveTicketResult = {
                success: false,
                archived: false,
                transcriptFailed: true,
                error: 'Transcript creation failed',
            };
            expect(result.success).toBe(false);
            expect(result.archived).toBe(false);
            expect(result.transcriptFailed).toBe(true);
            expect(result.error).toBe('Transcript creation failed');
        });

        test('a result with postId satisfies the interface', () => {
            const result: ArchiveTicketResult = {
                success: true,
                archived: true,
                postId: '1234567890',
            };
            expect(result.postId).toBe('1234567890');
        });
    });
});
