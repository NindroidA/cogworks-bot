import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { SavedRole } from '../../../typeorm/entities/SavedRole';
import {
  createRateLimitKey,
  LANGF,
  lang,
  logger,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';

const tl = lang.removeRole;
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const roleRemoveHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  // Require admin permissions
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Rate limit check (10 role operations per hour per user)
  const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'role-save');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ROLE_SAVE);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    logger(`Rate limit exceeded for role removal by user ${interaction.user.id}`, 'WARN');
    return;
  }

  const subCommand = interaction.options.getSubcommand(); // 'staff' or 'admin'
  const guildId = interaction.guildId || '';
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
    const typeFinder = await savedRoleRepo.findOneBy({ guildId, type: subCommand });

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
    logger(tl.fail + error, 'ERROR');
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
