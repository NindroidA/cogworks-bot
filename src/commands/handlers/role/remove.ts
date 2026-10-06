import { type CacheType, type ChatInputCommandInteraction, MessageFlags, roleMention } from 'discord.js';
import { In } from 'typeorm';
import { StaffRole } from '../../../typeorm/entities/StaffRole';
import {
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  lang,
  RateLimits,
  replyEphemeralError,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.removeRole;
const staffRoleRepo = lazyRepo(StaffRole);

export async function roleRemoveHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'role-save',
    limit: RateLimits.ROLE_SAVE,
    scope: 'user',
  });
  if (!guard.allowed) return;

  const subCommand = interaction.options.getSubcommand(); // 'staff' or 'admin'
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const role = interaction.options.getRole('role_id', true).id;

  try {
    // Match this role under the requested type only, in both stored formats
    // (raw ID, legacy `<@&id>`). Checking role and type separately reported
    // success when the role was saved under the other type and nothing was deleted.
    const saved = await staffRoleRepo.find({
      where: { guildId, type: subCommand, role: In([role, roleMention(role)]) },
    });

    if (saved.length === 0) {
      const anyOfType = await staffRoleRepo.findOneBy({ guildId, type: subCommand });
      await replyEphemeralError(interaction, anyOfType ? tl.dne : tl.noType);
      return;
    }

    await staffRoleRepo.remove(saved);

    // after completion, send an ephemeral success message
    const successMsg = subCommand === 'staff' ? tl.successStaff : tl.successAdmin;
    await interaction.reply({
      content: successMsg,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.error('Failed to remove role', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
      role,
    });
    await replyEphemeralError(interaction, tl.fail);
  }
}
