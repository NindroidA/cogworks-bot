import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { ReactionRoleMenu, ReactionRoleOption } from '../../../typeorm/entities/reactionRole';
import {
  enhancedLogger,
  guardFeatureRateLimit,
  invalidateMenuCache,
  LogCategory,
  lang,
  RateLimits,
  replyEphemeralError,
  updateMenuMessage,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { optionEmojiKey } from '../../../utils/reactionRole/optionEmoji';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);
const optionRepo = lazyRepo(ReactionRoleOption);

export async function reactionRoleRemoveHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureRateLimit(interaction, 'reactionroles', 'manage', {
    action: 'reactionrole-remove',
    limit: RateLimits.ANNOUNCEMENT_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guild) return;

  const menuId = parseInt(interaction.options.getString('menu', true), 10);
  const emoji = interaction.options.getString('emoji', true).trim();

  // Updating the menu message can outlast the 3s reply deadline
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const menu = await menuRepo.findOne({
      where: { id: menuId, guildId },
      relations: { options: true },
    });
    if (!menu) {
      await replyEphemeralError(interaction, tl.errors.menuNotFound);
      return;
    }

    // Find the option by emoji (custom emoji by id, so any spelling of it matches)
    const emojiKey = optionEmojiKey(emoji);
    const option = menu.options.find(o => optionEmojiKey(o.emoji) === emojiKey);
    if (!option) {
      await replyEphemeralError(interaction, tl.remove.notFound);
      return;
    }

    // Remove the option
    await optionRepo.remove(option);

    // Invalidate cache
    invalidateMenuCache(menu.messageId);

    // Reload and update the menu message
    const updatedMenu = await menuRepo.findOne({
      where: { id: menu.id, guildId },
      relations: { options: true },
    });
    if (updatedMenu) {
      await updateMenuMessage(updatedMenu, guild, { remove: [option.emoji] });
    }

    await interaction.editReply({
      content: tl.remove.success.replace('{emoji}', emoji).replace('{menu}', menu.name),
    });

    enhancedLogger.info('Reaction role option removed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuId: menu.id,
      emoji,
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error('Failed to remove reaction role option', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await replyEphemeralError(interaction, tl.remove.error);
  }
}
