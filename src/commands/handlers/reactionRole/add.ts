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
  validateAssignableRole,
  validateEmoji,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { optionEmojiKey } from '../../../utils/reactionRole/optionEmoji';

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

  // Reacting on the menu message can outlast the 3s reply deadline
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

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

    // Check duplicate emoji. Custom emoji compare by id, as the reaction lookup does,
    // so `<:x:id>`, `<a:x:id>` and a renamed emoji can't become two colliding options.
    const emojiKey = optionEmojiKey(emoji);
    if (menu.options.some(o => optionEmojiKey(o.emoji) === emojiKey)) {
      await replyEphemeralError(interaction, tl.add.duplicateEmoji);
      return;
    }

    // Check duplicate role
    if (menu.options.some(o => o.roleId === role.id)) {
      await replyEphemeralError(interaction, tl.add.duplicateRole);
      return;
    }

    // The bot grants the role, so check what the invoker may hand out (not just the bot)
    const roleValidation = await validateAssignableRole(
      { guild, user: interaction.user, memberPermissions: interaction.memberPermissions },
      role,
    );
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
    if (updatedMenu && !(await updateMenuMessage(updatedMenu, guild, { add: [emoji] }))) {
      // No reaction backs the option (bot can't see the channel or use the emoji): undo it
      await optionRepo.remove(option);
      invalidateMenuCache(menu.messageId);
      await updateMenuMessage(menu, guild, {});
      await replyEphemeralError(interaction, tl.add.menuUpdateFailed);
      return;
    }

    await interaction.editReply({
      content: tl.add.success
        .replace('{emoji}', emoji)
        .replace('{role}', `<@&${role.id}>`)
        .replace('{menu}', menu.name),
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
