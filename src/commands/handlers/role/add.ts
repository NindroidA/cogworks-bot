import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { StaffRole } from '../../../typeorm/entities/StaffRole';
import { enhancedLogger, guardAdminRateLimit, LogCategory, lang, RateLimits } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.addRole;
const staffRoleRepo = lazyRepo(StaffRole);

export async function roleAddHandler(interaction: ChatInputCommandInteraction<CacheType>) {
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
  const alias = interaction.options.getString('alias') || '';
  const roleFinder = await staffRoleRepo.findOneBy({ guildId, role });

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
    await staffRoleRepo.createQueryBuilder().insert().values(values).execute();

    // after completion, send an ephemeral success message
    const successMsg = subCommand === 'staff' ? tl.successStaff : tl.successAdmin;
    await interaction.reply({
      content: successMsg,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.error('Failed to add role', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
      role,
    });
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
