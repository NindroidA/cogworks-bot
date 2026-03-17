import type { Client, TextChannel } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { ReactionRoleOption } from '../../../typeorm/entities/reactionRole/ReactionRoleOption';
import { buildMenuEmbed, updateMenuMessage } from '../../reactionRole/menuBuilder';
import { invalidateGuildMenuCache } from '../../reactionRole/menuCache';
import { extractId, isValidSnowflake } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);
const optionRepo = AppDataSource.getRepository(ReactionRoleOption);

export function registerReactionRoleHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
): void {
  // POST /internal/guilds/:guildId/reaction-roles
  routes.set('POST /reaction-roles', async (guildId, body) => {
    const channelId = body.channelId as string;
    const title = body.title as string;
    if (!channelId || !title) {
      return { error: 'channelId and title are required' };
    }
    if (!isValidSnowflake(channelId)) return { error: 'Invalid channelId format' };

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { error: 'Guild not found' };

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return { error: 'Channel not found or not a text channel' };
    }

    const mode = (body.mode as 'normal' | 'unique' | 'lock') || 'normal';
    const description = (body.description as string) || null;

    // Create menu entity first (need ID for options)
    const menu = menuRepo.create({
      guildId,
      channelId,
      messageId: '', // placeholder, updated after sending
      name: title,
      description,
      mode,
      options: [],
    });

    // Create options if provided
    const rawOptions =
      (body.options as Array<{
        emoji: string;
        roleId: string;
        label?: string;
      }>) || [];

    const options: ReactionRoleOption[] = rawOptions.map((opt, idx) =>
      optionRepo.create({
        emoji: opt.emoji,
        roleId: opt.roleId,
        description: opt.label || null,
        sortOrder: idx,
      }),
    );
    menu.options = options;

    // Build and send embed
    const embed = buildMenuEmbed(menu);
    const sentMessage = await (channel as TextChannel).send({
      embeds: [embed],
    });

    // Add reactions
    for (const opt of options) {
      await sentMessage.react(opt.emoji);
    }

    // Update with actual message ID and save
    menu.messageId = sentMessage.id;
    await menuRepo.save(menu);

    invalidateGuildMenuCache(guildId);

    await writeAuditLog(guildId, 'reactionRole.create', body.triggeredBy as string, {
      menuId: menu.id,
    });
    return { success: true, menuId: menu.id, messageId: sentMessage.id };
  });

  // POST /internal/guilds/:guildId/reaction-roles/:id/rebuild
  routes.set('POST /reaction-roles/:id/rebuild', async (guildId, body, url) => {
    const menuId = extractId(url, 'reaction-roles');
    const menu = await menuRepo.findOne({
      where: { guildId, id: menuId },
      relations: ['options'],
    });
    if (!menu) return { error: 'Menu not found' };

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { error: 'Guild not found' };

    const success = await updateMenuMessage(menu, guild);
    if (!success) return { error: 'Failed to rebuild menu message' };

    invalidateGuildMenuCache(guildId);

    await writeAuditLog(guildId, 'reactionRole.rebuild', body.triggeredBy as string, { menuId });
    return { success: true };
  });
}
