/**
 * Permission Validator Unit Tests
 *
 * Tests permission checking functions using minimal mock objects.
 */

import { describe, expect, test } from 'bun:test';
import { type GuildMember, PermissionsBitField } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  PermissionNames,
  ValidationPermissionSets,
  hasAdminPermission,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasRole,
  hasAnyRole,
  isGuildOwner,
  requireBotOwner,
  requireGuild,
} from '../../../src/utils/validation/permissionValidator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockMember(permissions: bigint[]): GuildMember {
  return {
    permissions: {
      has: (permission: bigint) => permissions.includes(permission),
    },
  } as unknown as GuildMember;
}

function createMockMemberWithRoles(
  permissions: bigint[],
  roleIds: string[],
): GuildMember {
  return {
    permissions: {
      has: (permission: bigint) => permissions.includes(permission),
    },
    roles: {
      cache: {
        has: (id: string) => roleIds.includes(id),
      },
    },
  } as unknown as GuildMember;
}

function createMockOwnerMember(ownerId: string, memberId: string): GuildMember {
  return {
    id: memberId,
    permissions: {
      has: () => false,
    },
    guild: { ownerId },
  } as unknown as GuildMember;
}

// ===========================================================================
// hasAdminPermission
// ===========================================================================
describe('hasAdminPermission()', () => {
  test('should allow member with Administrator', () => {
    const member = createMockMember([PermissionsBitField.Flags.Administrator]);
    const result = hasAdminPermission(member);
    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  test('should deny member without Administrator', () => {
    const member = createMockMember([PermissionsBitField.Flags.ManageMessages]);
    const result = hasAdminPermission(member);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('Administrator');
  });

  test('should deny null member', () => {
    const result = hasAdminPermission(null);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('Could not verify');
  });
});

// ===========================================================================
// hasPermission
// ===========================================================================
describe('hasPermission()', () => {
  test('should allow member with required permission', () => {
    const member = createMockMember([PermissionsBitField.Flags.ManageChannels]);
    const result = hasPermission(member, PermissionsBitField.Flags.ManageChannels, 'Manage Channels');
    expect(result.allowed).toBe(true);
  });

  test('should deny member without required permission', () => {
    const member = createMockMember([]);
    const result = hasPermission(member, PermissionsBitField.Flags.ManageChannels, 'Manage Channels');
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('Manage Channels');
  });

  test('should deny null member', () => {
    const result = hasPermission(null, PermissionsBitField.Flags.ManageChannels, 'Manage Channels');
    expect(result.allowed).toBe(false);
  });
});

// ===========================================================================
// hasAnyPermission
// ===========================================================================
describe('hasAnyPermission()', () => {
  test('should allow if member has any listed permission', () => {
    const member = createMockMember([PermissionsBitField.Flags.ManageMessages]);
    const result = hasAnyPermission(
      member,
      [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageMessages],
      ['Administrator', 'Manage Messages'],
    );
    expect(result.allowed).toBe(true);
  });

  test('should deny if member has none of the listed permissions', () => {
    const member = createMockMember([PermissionsBitField.Flags.SendMessages]);
    const result = hasAnyPermission(
      member,
      [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageMessages],
      ['Administrator', 'Manage Messages'],
    );
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('Administrator');
    expect(result.message).toContain('Manage Messages');
  });

  test('should deny null member', () => {
    const result = hasAnyPermission(null, [PermissionsBitField.Flags.Administrator], ['Administrator']);
    expect(result.allowed).toBe(false);
  });
});

// ===========================================================================
// hasAllPermissions
// ===========================================================================
describe('hasAllPermissions()', () => {
  test('should allow member with all required permissions', () => {
    const member = createMockMember([
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageMessages,
    ]);
    const result = hasAllPermissions(
      member,
      [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages],
      ['Manage Channels', 'Manage Messages'],
    );
    expect(result.allowed).toBe(true);
  });

  test('should deny member missing one required permission', () => {
    const member = createMockMember([PermissionsBitField.Flags.ManageChannels]);
    const result = hasAllPermissions(
      member,
      [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages],
      ['Manage Channels', 'Manage Messages'],
    );
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('Manage Messages');
  });

  test('should deny null member', () => {
    const result = hasAllPermissions(null, [PermissionsBitField.Flags.ManageChannels], ['Manage Channels']);
    expect(result.allowed).toBe(false);
  });
});

// ===========================================================================
// isGuildOwner
// ===========================================================================
describe('isGuildOwner()', () => {
  test('should allow guild owner', () => {
    const member = createMockOwnerMember('owner-123', 'owner-123');
    const result = isGuildOwner(member);
    expect(result.allowed).toBe(true);
  });

  test('should deny non-owner', () => {
    const member = createMockOwnerMember('owner-123', 'user-456');
    const result = isGuildOwner(member);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('server owner');
  });

  test('should deny null member', () => {
    const result = isGuildOwner(null);
    expect(result.allowed).toBe(false);
  });
});

// ===========================================================================
// hasRole / hasAnyRole
// ===========================================================================
describe('hasRole()', () => {
  test('should allow member with role', () => {
    const member = createMockMemberWithRoles([], ['role-1']);
    const result = hasRole(member, 'role-1');
    expect(result.allowed).toBe(true);
  });

  test('should deny member without role', () => {
    const member = createMockMemberWithRoles([], ['role-2']);
    const result = hasRole(member, 'role-1', 'Admin');
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('Admin');
  });

  test('should deny null member', () => {
    const result = hasRole(null, 'role-1');
    expect(result.allowed).toBe(false);
  });
});

describe('hasAnyRole()', () => {
  test('should allow member with any matching role', () => {
    const member = createMockMemberWithRoles([], ['role-3']);
    const result = hasAnyRole(member, ['role-1', 'role-2', 'role-3']);
    expect(result.allowed).toBe(true);
  });

  test('should deny member with no matching roles', () => {
    const member = createMockMemberWithRoles([], ['role-99']);
    const result = hasAnyRole(member, ['role-1', 'role-2']);
    expect(result.allowed).toBe(false);
  });
});

// ===========================================================================
// requireGuild
// ===========================================================================
describe('requireGuild()', () => {
  test('should allow when guild is present', () => {
    const interaction = {
      guild: { id: '123' },
      guildId: '123',
    } as unknown as ChatInputCommandInteraction;
    const result = requireGuild(interaction);
    expect(result.allowed).toBe(true);
  });

  test('should deny when guild is null', () => {
    const interaction = {
      guild: null,
      guildId: null,
    } as unknown as ChatInputCommandInteraction;
    const result = requireGuild(interaction);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('server');
  });
});

// ===========================================================================
// requireBotOwner
// ===========================================================================
describe('requireBotOwner()', () => {
  const originalBotOwnerId = process.env.BOT_OWNER_ID;

  test('should allow matching bot owner', () => {
    process.env.BOT_OWNER_ID = 'owner-999';
    const result = requireBotOwner('owner-999');
    expect(result.allowed).toBe(true);
    process.env.BOT_OWNER_ID = originalBotOwnerId;
  });

  test('should deny non-matching user', () => {
    process.env.BOT_OWNER_ID = 'owner-999';
    const result = requireBotOwner('user-123');
    expect(result.allowed).toBe(false);
    process.env.BOT_OWNER_ID = originalBotOwnerId;
  });

  test('should deny when BOT_OWNER_ID is not set', () => {
    const saved = process.env.BOT_OWNER_ID;
    delete process.env.BOT_OWNER_ID;
    const result = requireBotOwner('any-user');
    expect(result.allowed).toBe(false);
    process.env.BOT_OWNER_ID = saved;
  });
});

// ===========================================================================
// Constants exports
// ===========================================================================
describe('ValidationPermissionSets', () => {
  test('MANAGE_TICKETS should contain ManageMessages and ManageChannels', () => {
    expect(ValidationPermissionSets.MANAGE_TICKETS).toContain(PermissionsBitField.Flags.ManageMessages);
    expect(ValidationPermissionSets.MANAGE_TICKETS).toContain(PermissionsBitField.Flags.ManageChannels);
  });
});

describe('PermissionNames', () => {
  test('should have ADMINISTRATOR as "Administrator"', () => {
    expect(PermissionNames.ADMINISTRATOR).toBe('Administrator');
  });

  test('should have MANAGE_GUILD as "Manage Server"', () => {
    expect(PermissionNames.MANAGE_GUILD).toBe('Manage Server');
  });
});
