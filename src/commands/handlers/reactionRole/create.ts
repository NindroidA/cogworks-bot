import {
  type CacheType,
  type ChatInputCommandInteraction,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  buildMenuEmbed,
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  MAX,
  RateLimits,
  rateLimiter,
  requireAdmin,
  sanitizeUserInput,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);

export async function reactionRoleCreateHandler(
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

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  // Rate limit (5 per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'reactionrole-create');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check max menus per guild (25)
  const menuCount = await menuRepo.count({ where: { guildId } });
  if (menuCount >= MAX.REACTION_ROLE_MENUS) {
    await interaction.reply({
      content: tl.create.maxMenus,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true) as TextChannel;
  const name = sanitizeUserInput(interaction.options.getString('name', true));
  const description = sanitizeUserInput(interaction.options.getString('description')) || null;
  const mode = (interaction.options.getString('mode') || 'normal') as 'normal' | 'unique' | 'lock';

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
    enhancedLogger.error(
      'Failed to create reaction role menu',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.create.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
