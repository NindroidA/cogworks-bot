/**
 * Role Delete Event Handler
 *
 * Cleans up config references when a role is deleted from the guild.
 * Prevents stale role IDs from causing errors when systems try to
 * assign or check roles that no longer exist.
 */

import type { Role } from 'discord.js';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { cleanRoleRefs } from '../utils/cleanup/refCleaners';

export default {
  name: 'roleDelete',
  async execute(role: Role, client: ExtendedClient) {
    const guildId = role.guild.id;
    const roleId = role.id;

    enhancedLogger.debug('Role deleted, checking config references', LogCategory.SYSTEM, {
      guildId,
      roleId,
      roleName: role.name,
    });

    await cleanRoleRefs(guildId, roleId, client);
  },
};
