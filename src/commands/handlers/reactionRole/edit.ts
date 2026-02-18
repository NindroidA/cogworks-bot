import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  createRateLimitKey,
  enhancedLogger,
  invalidateMenuCache,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
  updateMenuMessage,
} from '../../../utils';

const tl = lang.reactionRole;
const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

export async function reactionRoleEditHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId || '';
  const guild = interaction.guild;
  if (!guild) return;

  const menuId = parseInt(interaction.options.getString('menu', true), 10);
  const newName = interaction.options.getString('name');
  const newDescription = interaction.options.getString('description');
  const newMode = interaction.options.getString('mode') as 'normal' | 'unique' | 'lock' | null;

  // Rate limit (5 per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'reactionrole-edit');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check at least one change provided
  if (!newName && newDescription === null && !newMode) {
    await interaction.reply({
      content: tl.edit.noChanges,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const menu = await menuRepo.findOne({
      where: { id: menuId, guildId },
      relations: ['options'],
    });
    if (!menu) {
      await interaction.reply({
        content: tl.errors.menuNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Apply changes
    if (newName) menu.name = newName;
    if (newDescription !== null) menu.description = newDescription || null;
    if (newMode) menu.mode = newMode;

    await menuRepo.save(menu);

    // Invalidate cache
    invalidateMenuCache(menu.messageId);

    // Update the Discord message
    await updateMenuMessage(menu, guild);

    await interaction.reply({
      content: tl.edit.success.replace('{name}', menu.name),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Reaction role menu edited', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuId: menu.id,
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error(
      'Failed to edit reaction role menu',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.edit.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
