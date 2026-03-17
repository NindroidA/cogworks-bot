/**
 * Validators Unit Tests
 * 
 * Tests input validation utilities for Discord entities and data formats
 */

import { describe, expect, test } from '@jest/globals';
import { Channel, ChannelType, Guild, GuildMember, Role } from 'discord.js';
import {
    validateChannel,
    validateDateFormat,
    validateGuildId,
    validateMember,
    validateRole,
    validateString
} from '../../../src/utils/validation/validators';

describe('Validators', () => {
    describe('validateChannel()', () => {
        test('should return valid for existing channel', () => {
            const channel = { type: ChannelType.GuildText } as Partial<Channel> as Channel;
            const result = validateChannel(channel);

            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        test('should return invalid for null channel', () => {
            const result = validateChannel(null);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Channel not found.');
        });

        test('should return invalid for undefined channel', () => {
            const result = validateChannel(undefined);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Channel not found.');
        });

        test('should validate channel type when provided', () => {
            const channel = { type: ChannelType.GuildText } as Partial<Channel> as Channel;
            const result = validateChannel(channel, ChannelType.GuildText);

            expect(result.valid).toBe(true);
        });

        test('should reject wrong channel type', () => {
            const channel = { type: ChannelType.GuildText } as Partial<Channel> as Channel;
            const result = validateChannel(channel, ChannelType.GuildVoice);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Voice channel');
        });

        test('should handle GuildAnnouncement type', () => {
            const channel = { type: ChannelType.GuildText } as Partial<Channel> as Channel;
            const result = validateChannel(channel, ChannelType.GuildAnnouncement);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('News channel');
        });
    });

    describe('validateRole()', () => {
        test('should return valid for existing role', () => {
            const role = { id: '123', name: 'Test Role' } as Partial<Role> as Role;
            const result = validateRole(role);

            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        test('should return invalid for null role', () => {
            const result = validateRole(null);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Role not found.');
        });

        test('should return invalid for undefined role', () => {
            const result = validateRole(undefined);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Role not found.');
        });
    });

    describe('validateMember()', () => {
        test('should return valid for existing member', () => {
            const member = { id: '123', user: { tag: 'Test#1234' } } as Partial<GuildMember> as GuildMember;
            const result = validateMember(member);

            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        test('should return invalid for null member', () => {
            const result = validateMember(null);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Member not found.');
        });

        test('should return invalid for undefined member', () => {
            const result = validateMember(undefined);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Member not found.');
        });
    });

    describe('validateString()', () => {
        test('should return valid for non-empty string', () => {
            const result = validateString('Hello World');

            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        test('should return invalid for empty string', () => {
            const result = validateString('');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Value cannot be empty.');
        });

        test('should return invalid for whitespace-only string', () => {
            const result = validateString('   ');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Value cannot be empty.');
        });

        test('should return invalid for null', () => {
            const result = validateString(null);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Value cannot be empty.');
        });

        test('should return invalid for undefined', () => {
            const result = validateString(undefined);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Value cannot be empty.');
        });

        test('should validate minimum length', () => {
            const result = validateString('Hi', 5);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('at least 5 characters');
        });

        test('should pass minimum length check', () => {
            const result = validateString('Hello', 5);

            expect(result.valid).toBe(true);
        });

        test('should validate maximum length', () => {
            const result = validateString('This is a very long string', undefined, 10);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('not exceed 10 characters');
        });

        test('should pass maximum length check', () => {
            const result = validateString('Short', undefined, 10);

            expect(result.valid).toBe(true);
        });

        test('should validate both min and max length', () => {
            const result = validateString('Hello World', 5, 20);

            expect(result.valid).toBe(true);
        });

        test('should fail when too short with both constraints', () => {
            const result = validateString('Hi', 5, 20);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('at least 5');
        });

        test('should fail when too long with both constraints', () => {
            const result = validateString('This is way too long for the limit', 5, 20);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('not exceed 20');
        });
    });

    describe('validateGuildId()', () => {
        test('should return valid for existing guild', () => {
            const guild = { id: '123', name: 'Test Server' } as Partial<Guild> as Guild;
            const result = validateGuildId(guild);

            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        test('should return invalid for null guild', () => {
            const result = validateGuildId(null);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('server');
        });

        test('should return invalid for undefined guild', () => {
            const result = validateGuildId(undefined);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('server');
        });
    });

    describe('validateDateFormat()', () => {
        test('should return valid for valid date string', () => {
            const result = validateDateFormat('2025-10-28');

            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        test('should return valid for ISO 8601 format', () => {
            const result = validateDateFormat('2025-10-28T12:00:00Z');

            expect(result.valid).toBe(true);
        });

        test('should return valid for MM/DD/YYYY format', () => {
            const result = validateDateFormat('10/28/2025');

            expect(result.valid).toBe(true);
        });

        test('should return invalid for malformed date', () => {
            const result = validateDateFormat('not-a-date');

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid date format');
        });

        test('should return invalid for invalid date values', () => {
            const result = validateDateFormat('2025-13-45');

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid date format');
        });

        test('should include custom format in error message', () => {
            const result = validateDateFormat('invalid', 'MM/DD/YYYY');

            expect(result.valid).toBe(false);
            expect(result.error).toContain('MM/DD/YYYY');
        });

        test('should use default format in error when not specified', () => {
            const result = validateDateFormat('invalid');

            expect(result.valid).toBe(false);
            expect(result.error).toContain('YYYY-MM-DD');
        });
    });
});
