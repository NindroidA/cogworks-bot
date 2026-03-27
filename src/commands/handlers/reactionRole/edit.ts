import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  enhancedLogger,
  guardAdminRateLimit,
  invalidateMenuCache,
  LogCategory,
  lang,
  RateLimits,
  sanitizeUserInput,
  updateMenuMessage,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);

export async function reactionRoleEditHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardAdminRateLimit(interaction, {
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
  const newMode = interaction.options.getString('mode') as 'normal' | 'unique' | 'lock' | null;

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
    if (newDescription !== null) menu.description = sanitizeUserInput(newDescription) || null;
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
    enhancedLogger.error('Failed to edit reaction role menu', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: tl.edit.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
