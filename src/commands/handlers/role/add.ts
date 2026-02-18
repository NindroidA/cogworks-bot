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

const tl = lang.addRole;
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const roleAddHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  // Require admin permissions
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Rate limit check (10 role saves per hour per user)
  const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'role-save');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ROLE_SAVE);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    logger(`Rate limit exceeded for role save by user ${interaction.user.id}`, 'WARN');
    return;
  }

  const subCommand = interaction.options.getSubcommand(); // 'staff' or 'admin'
  const guildId = interaction.guildId || '';
  const role = interaction.options.getRole('role_id')!.toString() || '';
  const alias = interaction.options.getString('alias') || '';
  const roleFinder = await savedRoleRepo.findOneBy({ guildId, role });

  // check to see if role id is already saved
  if (roleFinder) {
    await interaction.reply({
      content: tl.alreadyAdded,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const values = [{ guildId: guildId, type: subCommand, role: role, alias: alias }];

    // insert a new entry to the table
    await savedRoleRepo.createQueryBuilder().insert().values(values).execute();

    // after completion, send an ephemeral success message
    const successMsg = subCommand === 'staff' ? tl.successStaff : tl.successAdmin;
    await interaction.reply({
      content: successMsg,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    logger(lang.addRole.fail + error, 'ERROR');
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
