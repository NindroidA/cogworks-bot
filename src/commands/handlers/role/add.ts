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
  // Store the raw snowflake (the format the dashboard writes). Role.toString()
  // gave `<@&id>`, which the dashboard and roleDelete never matched, and the
  // literal "@everyone" for the guild's default role.
  const role = interaction.options.getRole('role_id', true).id;
  if (role === guildId) {
    await replyEphemeralError(interaction, lang.botSetup.errors.everyoneNotAllowedGeneric);
    return;
  }
  const alias = interaction.options.getString('alias') || '';
  // Legacy rows hold `<@&id>` — match both so a role can't be saved twice.
  const roleFinder = await staffRoleRepo.findOneBy({ guildId, role: In([role, roleMention(role)]) });

  // check to see if role id is already saved
  if (roleFinder) {
    await replyEphemeralError(interaction, tl.alreadyAdded);
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
    await replyEphemeralError(interaction, tl.fail);
  }
}
