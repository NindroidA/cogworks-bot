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
  validateEmoji,
  validateRoleForMenu,
} from '../../../utils';

const tl = lang.reactionRole;
const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);
const optionRepo = AppDataSource.getRepository(ReactionRoleOption);

export async function reactionRoleAddHandler(interaction: ChatInputCommandInteraction<CacheType>) {
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
  const role = interaction.options.getRole('role', true);
  const description = interaction.options.getString('description') || null;

  // Rate limit (5 per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'reactionrole-add');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Validate emoji format
  const emojiCheck = validateEmoji(emoji);
  if (!emojiCheck.valid) {
    await interaction.reply({
      content: tl.add.invalidEmoji,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    // Find the menu
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

    // Max 20 options (Discord reaction limit)
    if (menu.options.length >= 20) {
      await interaction.reply({
        content: tl.add.maxOptions,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check duplicate emoji
    if (menu.options.some(o => o.emoji === emoji)) {
      await interaction.reply({
        content: tl.add.duplicateEmoji,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check duplicate role
    if (menu.options.some(o => o.roleId === role.id)) {
      await interaction.reply({
        content: tl.add.duplicateRole,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate role
    const botMember = await guild.members.fetchMe();
    const roleValidation = validateRoleForMenu(role, guild, botMember.roles.highest.position);
    if (!roleValidation.valid) {
      await interaction.reply({
        content: roleValidation.error!,
        flags: [MessageFlags.Ephemeral],
      });
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
      relations: ['options'],
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
    enhancedLogger.error(
      'Failed to add reaction role option',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.add.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
