import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { ReactionRoleMenu, ReactionRoleOption } from '../../../typeorm/entities/reactionRole';
import {
  enhancedLogger,
  guardFeatureRateLimit,
  invalidateMenuCache,
  LogCategory,
  lang,
  MAX,
  RateLimits,
  replyEphemeralError,
  updateMenuMessage,
  validateEmoji,
  validateRoleForMenu,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);
const optionRepo = lazyRepo(ReactionRoleOption);

export async function reactionRoleAddHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureRateLimit(interaction, 'reactionroles', 'manage', {
    action: 'reactionrole-add',
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
  const role = interaction.options.getRole('role', true);
  const description = interaction.options.getString('description') || null;

  // Validate emoji format
  const emojiCheck = validateEmoji(emoji);
  if (!emojiCheck.valid) {
    await replyEphemeralError(interaction, tl.add.invalidEmoji);
    return;
  }

  try {
    // Find the menu
    const menu = await menuRepo.findOne({
      where: { id: menuId, guildId },
      relations: { options: true },
    });
    if (!menu) {
      await replyEphemeralError(interaction, tl.errors.menuNotFound);
      return;
    }

    // Max 20 options (Discord reaction limit)
    if (menu.options.length >= MAX.REACTION_ROLE_OPTIONS) {
      await replyEphemeralError(interaction, tl.add.maxOptions);
      return;
    }

    // Check duplicate emoji
    if (menu.options.some(o => o.emoji === emoji)) {
      await replyEphemeralError(interaction, tl.add.duplicateEmoji);
      return;
    }

    // Check duplicate role
    if (menu.options.some(o => o.roleId === role.id)) {
      await replyEphemeralError(interaction, tl.add.duplicateRole);
      return;
    }

    // Validate role
    const botMember = await guild.members.fetchMe();
    const roleValidation = validateRoleForMenu(role, guild, botMember.roles.highest.position);
    if (!roleValidation.valid) {
      await replyEphemeralError(interaction, roleValidation.error!);
      return;
    }

    // Create the option
    const option = optionRepo.create({
      menuId: menu.id,
      emoji,
      roleId: role.id,
      description,
      sortOrder: menu.options.length,
    });
    await optionRepo.save(option);

    // Invalidate cache so reaction handler picks up the new option
    invalidateMenuCache(menu.messageId);

    // Reload menu with new option and update the message
    const updatedMenu = await menuRepo.findOne({
      where: { id: menu.id, guildId },
      relations: { options: true },
    });
    if (updatedMenu) {
      await updateMenuMessage(updatedMenu, guild);
    }

    await interaction.reply({
      content: tl.add.success
        .replace('{emoji}', emoji)
        .replace('{role}', `<@&${role.id}>`)
        .replace('{menu}', menu.name),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Reaction role option added', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuId: menu.id,
      emoji,
      roleId: role.id,
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error('Failed to add reaction role option', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await replyEphemeralError(interaction, tl.add.error);
  }
}
