import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { SavedRole } from '../../../typeorm/entities/SavedRole';
import { enhancedLogger, guardAdminRateLimit, LogCategory, lang, RateLimits } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.removeRole;
const savedRoleRepo = lazyRepo(SavedRole);

export const roleRemoveHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'role-save',
    limit: RateLimits.ROLE_SAVE,
    scope: 'user',
  });
  if (!guard.allowed) return;

  const subCommand = interaction.options.getSubcommand(); // 'staff' or 'admin'
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const role = interaction.options.getRole('role_id')!.toString() || '';
  const roleFinder = await savedRoleRepo.findOneBy({ guildId, role });
  const guildFinder = await savedRoleRepo.findOneBy({ guildId });

  // check to see if the discord server has any saved roles
  if (!guildFinder) {
    await interaction.reply({
      content: tl.noType,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // check to see if the role exists
  if (!roleFinder) {
    await interaction.reply({
      content: tl.dne,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const typeFinder = await savedRoleRepo.findOneBy({
      guildId,
      type: subCommand,
    });

    if (!typeFinder) {
      await interaction.reply({
        content: tl.noType,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await savedRoleRepo
      .createQueryBuilder()
      .delete()
      .where('role = :role', { role: role })
      .andWhere('type = :type', { type: subCommand })
      .andWhere('guildId = :guildId', { guildId })
      .execute();

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
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
