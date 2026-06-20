import { type CacheType, type ChatInputCommandInteraction, MessageFlags, type TextChannel } from 'discord.js';
import { ReactionRoleMenu, type ReactionRoleMode } from '../../../typeorm/entities/reactionRole';
import {
  buildMenuEmbed,
  enhancedLogger,
  guardFeatureRateLimit,
  LogCategory,
  lang,
  MAX,
  RateLimits,
  replyEphemeralError,
  sanitizeUserInput,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);

export async function reactionRoleCreateHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureRateLimit(interaction, 'reactionroles', 'manage', {
    action: 'reactionrole-create',
    limit: RateLimits.ANNOUNCEMENT_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  // Check max menus per guild (25)
  const menuCount = await menuRepo.count({ where: { guildId } });
  if (menuCount >= MAX.REACTION_ROLE_MENUS) {
    await replyEphemeralError(interaction, tl.create.maxMenus);
    return;
  }

  const channel = interaction.options.getChannel('channel', true) as TextChannel;
  const name = sanitizeUserInput(interaction.options.getString('name', true));
  const description = sanitizeUserInput(interaction.options.getString('description')) || null;
  const mode = (interaction.options.getString('mode') || 'normal') as ReactionRoleMode;

  try {
    // Create the menu entity (no options yet)
    const menu = menuRepo.create({
      guildId,
      channelId: channel.id,
      messageId: '', // Placeholder — will update after sending
      name,
      description,
      mode,
      options: [],
    });

    // Build and send the embed
    const embed = buildMenuEmbed(menu);
    const sentMessage = await channel.send({ embeds: [embed] });

    // Update with actual message ID and save
    menu.messageId = sentMessage.id;
    await menuRepo.save(menu);

    await interaction.reply({
      content: tl.create.success.replace('{name}', name).replace('{channel}', `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Reaction role menu created', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuId: menu.id,
      name,
      mode,
      channelId: channel.id,
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error('Failed to create reaction role menu', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await replyEphemeralError(interaction, tl.create.error);
  }
}
