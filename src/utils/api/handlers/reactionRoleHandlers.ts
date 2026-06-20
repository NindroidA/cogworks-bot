import type { Client, TextChannel } from 'discord.js';
import { ReactionRoleMenu, type ReactionRoleMode } from '../../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { ReactionRoleOption } from '../../../typeorm/entities/reactionRole/ReactionRoleOption';
import { lazyRepo } from '../../database/lazyRepo';
import { buildMenuEmbed, updateMenuMessage } from '../../reactionRole/menuBuilder';
import { invalidateGuildMenuCache } from '../../reactionRole/menuCache';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalString, requireId, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditAction } from './auditHelper';

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
    if (!channel?.isTextBased()) {
      throw ApiError.notFound('Channel not found or not a text channel');
    }

    const mode = (optionalString(body, 'mode') as ReactionRoleMode) || 'normal';
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

    // Create options if provided — validate each before any Discord write (no
    // unchecked `as` cast on body fields per project rules; an invalid roleId
    // or empty emoji must not silently create a broken menu or orphan a message).
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const options: ReactionRoleOption[] = rawOptions.map((raw, idx) => {
      const opt = (raw ?? {}) as { emoji?: unknown; roleId?: unknown; label?: unknown };
      const emoji = typeof opt.emoji === 'string' ? opt.emoji.trim() : '';
      const roleId = typeof opt.roleId === 'string' ? opt.roleId : '';
      if (!emoji) throw ApiError.badRequest(`options[${idx}]: emoji is required`);
      if (!isValidSnowflake(roleId)) throw ApiError.badRequest(`options[${idx}]: invalid roleId`);
      const label = typeof opt.label === 'string' ? opt.label : null;
      return optionRepo.create({ emoji, roleId, description: label, sortOrder: idx });
    });
    menu.options = options;

    // Build and send embed
    const embed = buildMenuEmbed(menu);
    const sentMessage = await (channel as TextChannel).send({
      embeds: [embed],
    });

    // Add reactions — if an emoji is invalid the message would otherwise be left
    // orphaned (sent, but no backing DB row yet), so clean it up and surface 400.
    try {
      for (const opt of options) {
        await sentMessage.react(opt.emoji);
      }
    } catch {
      await sentMessage.delete().catch(() => {});
      throw ApiError.badRequest('Failed to add a reaction — check the emoji values');
    }

    // Update with actual message ID and save
    menu.messageId = sentMessage.id;
    await menuRepo.save(menu);

    invalidateGuildMenuCache(guildId);

    await writeAuditAction(guildId, body, 'reactionRole.create', {
      menuId: menu.id,
    });
    return { success: true, menuId: menu.id, messageId: sentMessage.id };
  });

  // POST /internal/guilds/:guildId/reaction-roles/:id/rebuild
  routes.set('POST /reaction-roles/:id/rebuild', async (guildId, body, url) => {
    const menuId = requireId(url, 'reaction-roles');
    const menu = await menuRepo.findOne({
      where: { guildId, id: menuId },
      relations: { options: true },
    });
    if (!menu) throw ApiError.notFound('Menu not found');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const success = await updateMenuMessage(menu, guild);
    if (!success) throw ApiError.badRequest('Failed to rebuild menu message');

    invalidateGuildMenuCache(guildId);

    await writeAuditAction(guildId, body, 'reactionRole.rebuild', {
      menuId,
    });
    return { success: true };
  });
}
