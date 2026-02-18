import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ReactionRoleMenu, ReactionRoleOption } from '../../../typeorm/entities/reactionRole';
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
const optionRepo = AppDataSource.getRepository(ReactionRoleOption);

export async function reactionRoleRemoveHandler(
  interaction: ChatInputCommandInteraction<CacheType>,
) {
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
  const emoji = interaction.options.getString('emoji', true).trim();

  // Rate limit (5 per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'reactionrole-remove');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
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

    // Find the option by emoji
    const option = menu.options.find(o => o.emoji === emoji);
    if (!option) {
      await interaction.reply({
        content: tl.remove.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Remove the option
    await optionRepo.remove(option);

    // Invalidate cache
    invalidateMenuCache(menu.messageId);

    // Reload and update the menu message
    const updatedMenu = await menuRepo.findOne({
      where: { id: menu.id, guildId },
      relations: ['options'],
    });
    if (updatedMenu) {
      await updateMenuMessage(updatedMenu, guild);
    }

    await interaction.reply({
      content: tl.remove.success.replace('{emoji}', emoji).replace('{menu}', menu.name),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Reaction role option removed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuId: menu.id,
      emoji,
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error(
      'Failed to remove reaction role option',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.remove.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
