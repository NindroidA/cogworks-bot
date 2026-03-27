import type { Client, TextChannel } from 'discord.js';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { ReactionRoleOption } from '../../../typeorm/entities/reactionRole/ReactionRoleOption';
import { lazyRepo } from '../../database/lazyRepo';
import { buildMenuEmbed, updateMenuMessage } from '../../reactionRole/menuBuilder';
import { invalidateGuildMenuCache } from '../../reactionRole/menuCache';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalString, requireId, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const menuRepo = lazyRepo(ReactionRoleMenu);
const optionRepo = lazyRepo(ReactionRoleOption);

export function registerReactionRoleHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/reaction-roles
  routes.set('POST /reaction-roles', async (guildId, body) => {
    const channelId = requireString(body, 'channelId');
    const title = requireString(body, 'title');
    if (!isValidSnowflake(channelId)) throw ApiError.badRequest('Invalid channelId format');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw ApiError.notFound('Channel not found or not a text channel');
    }

    const mode = (optionalString(body, 'mode') as 'normal' | 'unique' | 'lock') || 'normal';
    const description = optionalString(body, 'description') ?? null;

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

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'reactionRole.create', triggeredBy, {
      menuId: menu.id,
    });
    return { success: true, menuId: menu.id, messageId: sentMessage.id };
  });

  // POST /internal/guilds/:guildId/reaction-roles/:id/rebuild
  routes.set('POST /reaction-roles/:id/rebuild', async (guildId, body, url) => {
    const menuId = requireId(url, 'reaction-roles');
    const menu = await menuRepo.findOne({
      where: { guildId, id: menuId },
      relations: ['options'],
    });
    if (!menu) throw ApiError.notFound('Menu not found');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const success = await updateMenuMessage(menu, guild);
    if (!success) throw ApiError.badRequest('Failed to rebuild menu message');

    invalidateGuildMenuCache(guildId);

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'reactionRole.rebuild', triggeredBy, { menuId });
    return { success: true };
  });
}
