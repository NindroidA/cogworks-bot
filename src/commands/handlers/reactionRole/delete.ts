import { ButtonStyle, type CacheType, type ChatInputCommandInteraction, type TextChannel } from 'discord.js';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  awaitConfirmation,
  buildErrorMessage,
  type DeleteResult,
  enhancedLogger,
  fmt,
  guardFeatureAccess,
  handleInteractionError,
  invalidateMenuCache,
  LogCategory,
  lang,
  replyEphemeralError,
  verifiedMessageDeleteById,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);

export async function reactionRoleDeleteHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'reactionroles', 'manage');
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guild) return;

  const menuId = parseInt(interaction.options.getString('menu', true), 10);

  try {
    const menu = await menuRepo.findOne({ where: { id: menuId, guildId } });
    if (!menu) {
      await replyEphemeralError(interaction, tl.errors.menuNotFound);
      return;
    }

    const result = await awaitConfirmation(interaction, {
      message: fmt(tl.delete.confirmMessage, { name: menu.name }),
      confirmStyle: ButtonStyle.Danger,
      idPrefix: 'rr-delete',
    });
    if (!result) return;

    // Delete the Discord message first (verified). Only "already gone" lets the row go:
    // on any other failure the message stays up, so the row that backs it stays too.
    let deleted: DeleteResult = { success: true, alreadyGone: true };
    try {
      const channel = await guild.channels.fetch(menu.channelId);
      if (channel?.isTextBased()) {
        deleted = await verifiedMessageDeleteById(channel as TextChannel, menu.messageId, {
          guildId,
          label: 'reaction role menu message',
        });
      }
    } catch (error) {
      // 10003 Unknown Channel: the menu went with its channel
      if ((error as { code?: number }).code !== 10003) deleted = { success: false, alreadyGone: false };
    }
    if (!deleted.success) {
      await result.interaction.editReply({
        content: buildErrorMessage(fmt(tl.delete.messageNotDeleted, { name: menu.name })),
      });
      return;
    }

    // Invalidate cache and delete from DB (CASCADE will remove options)
    invalidateMenuCache(menu.messageId);
    await menuRepo.remove(menu);

    await result.interaction.editReply({ content: fmt(tl.delete.success, { name: menu.name }) });

    enhancedLogger.info('Reaction role menu deleted', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuId: menu.id,
      menuName: menu.name,
      userId: interaction.user.id,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to delete reaction role menu');
  }
}
