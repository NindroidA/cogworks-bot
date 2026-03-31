import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { SavedRole } from '../../../typeorm/entities/SavedRole';
import { enhancedLogger, guardAdminRateLimit, LogCategory, lang, RateLimits } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.getRoles;
const savedRoleRepo = lazyRepo(SavedRole);

export async function roleListHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'get-roles',
    limit: RateLimits.ROLE_SAVE,
    scope: 'user',
  });
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  const guildFinder = await savedRoleRepo.findOneBy({ guildId });

  // check to see if the discord server has any saved roles
  if (!guildFinder) {
    await interaction.reply({
      content: tl.noGuild,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    // message that'll be formatted
    let message = '';

    // select the saved roles for the guild
    const foundRoles = await savedRoleRepo
      .createQueryBuilder()
      .select('type')
      .addSelect('role')
      .addSelect('alias')
      .where('guildId = :guildId', { guildId: guildId })
      .getRawMany();

    // group roles by type
    const roleGroups: Record<string, { alias: string; role: string }[]> = {};
    foundRoles.forEach(role => {
      if (!roleGroups[role.type]) {
        roleGroups[role.type] = [];
      }
      roleGroups[role.type].push({
        alias: role.alias,
        role: role.role,
      });
    });

    // format staff roles
    if (roleGroups.staff) {
      message += '**Staff Roles:**\n';
      roleGroups.staff.forEach(r => {
        message += `* ${r.alias} - ${r.role}\n`;
      });
      message += '\n';
    }

    // format admin roles
    if (roleGroups.admin) {
      message += '**Admin Roles:**\n';
      roleGroups.admin.forEach(r => {
        message += `* ${r.alias} - ${r.role}\n`;
      });
      message += '\n';
    }

    // if no roles found
    if (message === '') {
      message = tl.noGuild;
    }

    await interaction.reply({
      content: message,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.error('Failed to list roles', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
