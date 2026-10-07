import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { ReactionRoleMenu, type ReactionRoleMode } from '../../../typeorm/entities/reactionRole';
import {
  enhancedLogger,
  fmt,
  guardFeatureRateLimit,
  invalidateMenuCache,
  LogCategory,
  lang,
  RateLimits,
  replyEphemeralError,
  sanitizeUserInput,
  updateMenuMessage,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);

export async function reactionRoleEditHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureRateLimit(interaction, 'reactionroles', 'manage', {
    action: 'reactionrole-edit',
    limit: RateLimits.ANNOUNCEMENT_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guild) return;

  const menuId = parseInt(interaction.options.getString('menu', true), 10);
  const newName = sanitizeUserInput(interaction.options.getString('name')) || null;
  const newDescription = interaction.options.getString('description');
  const newMode = interaction.options.getString('mode') as ReactionRoleMode | null;

  // Check at least one change provided
  if (!newName && newDescription === null && !newMode) {
    await replyEphemeralError(interaction, tl.edit.noChanges);
    return;
  }

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

    // Apply changes
    if (newName) menu.name = newName;
    if (newDescription !== null) menu.description = sanitizeUserInput(newDescription) || null;
    if (newMode) menu.mode = newMode;

    await menuRepo.save(menu);

    // Invalidate cache
    invalidateMenuCache(menu.messageId);

    // Update the Discord message (name, description and mode don't change the reactions)
    const updated = await updateMenuMessage(menu, guild, {});

    const success = fmt(tl.edit.success, { name: menu.name });
    await interaction.editReply({ content: updated ? success : `${success}\n\n${tl.menu.updateFailed}` });

    enhancedLogger.info('Reaction role menu edited', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuId: menu.id,
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error('Failed to edit reaction role menu', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await replyEphemeralError(interaction, tl.edit.error);
  }
}
