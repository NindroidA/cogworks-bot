import {
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  awaitConfirmation,
  buildErrorMessage,
  enhancedLogger,
  guardAdmin,
  handleInteractionError,
  invalidateMenuCache,
  LogCategory,
  lang,
  verifiedMessageDelete,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);

export async function reactionRoleDeleteHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardAdmin(interaction);
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guild) return;

  const menuId = parseInt(interaction.options.getString('menu', true), 10);

  try {
    const menu = await menuRepo.findOne({ where: { id: menuId, guildId } });
    if (!menu) {
      await interaction.reply({
        content: tl.errors.menuNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const result = await awaitConfirmation(interaction, {
      message: tl.delete.confirmMessage.replace('{name}', menu.name),
      confirmStyle: ButtonStyle.Danger,
      idPrefix: 'rr-delete',
    });
    if (!result) return;

    // Delete the Discord message first (verified)
    let msgDeleteFailed = false;
    try {
      const channel = await guild.channels.fetch(menu.channelId);
      if (channel?.isTextBased()) {
        const msg = await (channel as TextChannel).messages.fetch(menu.messageId);
        const delResult = await verifiedMessageDelete(msg, {
          guildId,
          label: 'reaction role menu message',
        });
        if (!delResult.success) {
          msgDeleteFailed = true;
        }
      }
    } catch {
      // Channel or message not found — already gone, proceed with DB cleanup
    }

    // Invalidate cache and delete from DB (CASCADE will remove options)
    invalidateMenuCache(menu.messageId);
    await menuRepo.remove(menu);

    await result.interaction.editReply({
      content: msgDeleteFailed
        ? buildErrorMessage(
            `${tl.delete.success.replace('{name}', menu.name)}\n\n⚠️ The Discord message could not be deleted — you may need to remove it manually.`,
          )
        : tl.delete.success.replace('{name}', menu.name),
    });

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
