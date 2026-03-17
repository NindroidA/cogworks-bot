/**
 * Permission Validator Unit Tests
 * 
 * Tests permission checking functionality for commands
 */

import { describe, expect, jest, test } from '@jest/globals';
import { ChatInputCommandInteraction, GuildMember, PermissionsBitField } from 'discord.js';
import {
    hasAdminPermission,
    hasAllPermissions,
    hasAnyPermission,
    hasPermission,
    requireAdmin
} from '../../../src/utils/validation/permissionValidator';

// Mock GuildMember
const createMockMember = (permissions: bigint[]): GuildMember => {
    return {
        permissions: {
            has: jest.fn((permission: bigint) => permissions.includes(permission))
        }
    } as unknown as GuildMember;
};

describe('PermissionValidator', () => {
    describe('hasAdminPermission()', () => {
        test('should allow member with Administrator permission', () => {
            const member = createMockMember([PermissionsBitField.Flags.Administrator]);
            const result = hasAdminPermission(member);

            expect(result.allowed).toBe(true);
            expect(result.message).toBeUndefined();
        });

        test('should deny member without Administrator permission', () => {
            const member = createMockMember([PermissionsBitField.Flags.ManageMessages]);
            const result = hasAdminPermission(member);

            expect(result.allowed).toBe(false);
            expect(result.message).toBeDefined();
            expect(result.message).toContain('Administrator');
        });

        test('should deny null member', () => {
            const result = hasAdminPermission(null);

            expect(result.allowed).toBe(false);
            expect(result.message).toBeDefined();
            expect(result.message).toContain('Could not verify');
        });
    });

    describe('hasPermission()', () => {
        test('should allow member with required permission', () => {
            const member = createMockMember([PermissionsBitField.Flags.ManageChannels]);
            const result = hasPermission(
                member,
                PermissionsBitField.Flags.ManageChannels,
                'Manage Channels'
            );

            expect(result.allowed).toBe(true);
            expect(result.message).toBeUndefined();
        });

        test('should deny member without required permission', () => {
            const member = createMockMember([PermissionsBitField.Flags.SendMessages]);
            const result = hasPermission(
                member,
                PermissionsBitField.Flags.ManageChannels,
                'Manage Channels'
            );

            expect(result.allowed).toBe(false);
            expect(result.message).toContain('Manage Channels');
        });

        test('should deny null member', () => {
            const result = hasPermission(
                null,
                PermissionsBitField.Flags.ManageChannels,
                'Manage Channels'
            );

            expect(result.allowed).toBe(false);
            expect(result.message).toContain('Could not verify');
        });

        test('should include custom permission name in message', () => {
            const member = createMockMember([]);
            const result = hasPermission(
                member,
                PermissionsBitField.Flags.BanMembers,
                'Ban Members'
            );

            expect(result.message).toContain('Ban Members');
        });
    });

    describe('hasAnyPermission()', () => {
        test('should allow member with any of the required permissions', () => {
            const member = createMockMember([PermissionsBitField.Flags.ManageMessages]);
            const result = hasAnyPermission(
                member,
                [
                    PermissionsBitField.Flags.Administrator,
                    PermissionsBitField.Flags.ManageMessages,
                    PermissionsBitField.Flags.ManageChannels
                ],
                ['Administrator', 'Manage Messages', 'Manage Channels']
            );

            expect(result.allowed).toBe(true);
        });

        test('should deny member without any required permissions', () => {
            const member = createMockMember([PermissionsBitField.Flags.SendMessages]);
            const result = hasAnyPermission(
                member,
                [
                    PermissionsBitField.Flags.Administrator,
                    PermissionsBitField.Flags.ManageMessages
                ],
                ['Administrator', 'Manage Messages']
            );

            expect(result.allowed).toBe(false);
            expect(result.message).toContain('Administrator');
            expect(result.message).toContain('Manage Messages');
        });

        test('should allow member with first permission in list', () => {
            const member = createMockMember([PermissionsBitField.Flags.Administrator]);
            const result = hasAnyPermission(
                member,
                [
                    PermissionsBitField.Flags.Administrator,
                    PermissionsBitField.Flags.ManageGuild
                ],
                ['Administrator', 'Manage Server']
            );

            expect(result.allowed).toBe(true);
        });

        test('should allow member with last permission in list', () => {
            const member = createMockMember([PermissionsBitField.Flags.ManageGuild]);
            const result = hasAnyPermission(
                member,
                [
                    PermissionsBitField.Flags.Administrator,
                    PermissionsBitField.Flags.ManageGuild
                ],
                ['Administrator', 'Manage Server']
            );

            expect(result.allowed).toBe(true);
        });

        test('should deny null member', () => {
            const result = hasAnyPermission(
                null,
                [PermissionsBitField.Flags.Administrator],
                ['Administrator']
            );

            expect(result.allowed).toBe(false);
        });
    });

    describe('hasAllPermissions()', () => {
        test('should allow member with all required permissions', () => {
            const member = createMockMember([
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.ManageRoles
            ]);
            const result = hasAllPermissions(
                member,
                [
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.ManageMessages
                ],
                ['Manage Channels', 'Manage Messages']
            );

            expect(result.allowed).toBe(true);
        });

        test('should deny member missing one required permission', () => {
            const member = createMockMember([PermissionsBitField.Flags.ManageChannels]);
            const result = hasAllPermissions(
                member,
                [
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.ManageMessages
                ],
                ['Manage Channels', 'Manage Messages']
            );

            expect(result.allowed).toBe(false);
            // Only reports FIRST missing permission
            expect(result.message).toContain('Manage Messages');
        });

        test('should deny member with no required permissions', () => {
            const member = createMockMember([PermissionsBitField.Flags.SendMessages]);
            const result = hasAllPermissions(
                member,
                [
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.ManageMessages
                ],
                ['Manage Channels', 'Manage Messages']
            );

            expect(result.allowed).toBe(false);
        });

        test('should deny null member', () => {
            const result = hasAllPermissions(
                null,
                [PermissionsBitField.Flags.ManageChannels],
                ['Manage Channels']
            );

            expect(result.allowed).toBe(false);
        });
    });

    describe('requireAdmin()', () => {
        test('should return allowed for member with admin permission', () => {
            const member = createMockMember([PermissionsBitField.Flags.Administrator]);
            const interaction = {
                member,
                guild: { id: '123' },
                guildId: '123'
            } as ChatInputCommandInteraction;

            const result = requireAdmin(interaction);

            expect(result.allowed).toBe(true);
        });

        test('should return denied for member without admin permission', () => {
            const member = createMockMember([PermissionsBitField.Flags.SendMessages]);
            const interaction = {
                member,
                guild: { id: '123' },
                guildId: '123',
                user: { tag: 'TestUser#1234' },
                commandName: 'testcommand'
            } as ChatInputCommandInteraction;

            const result = requireAdmin(interaction);

            expect(result.allowed).toBe(false);
            expect(result.message).toContain('Administrator');
        });

        test('should return denied for interaction not in guild', () => {
            const interaction = {
                member: null,
                guild: null,
                guildId: null
            } as ChatInputCommandInteraction;

            const result = requireAdmin(interaction);

            expect(result.allowed).toBe(false);
            expect(result.message).toContain('server');
        });
    });
});
