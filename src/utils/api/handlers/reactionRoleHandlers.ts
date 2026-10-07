import type { Client, TextChannel } from 'discord.js';
import { lang } from '../../../lang';
import { ReactionRoleMenu, type ReactionRoleMode } from '../../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { ReactionRoleOption } from '../../../typeorm/entities/reactionRole/ReactionRoleOption';
import { MAX } from '../../constants';
import { lazyRepo } from '../../database/lazyRepo';
import { buildMenuEmbed, updateMenuMessage, validateRoleForMenu } from '../../reactionRole/menuBuilder';
import { invalidateGuildMenuCache } from '../../reactionRole/menuCache';
import { optionEmojiKey } from '../../reactionRole/optionEmoji';
import { hasPrivilegedPermissions, validateAssignableRole, validateEmoji } from '../../validation/validators';
import { ApiError } from '../apiError';
import { getAndValidateEntity, isValidSnowflake, optionalEnum, optionalString, requireString } from '../helpers';
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

    // Validated union — a garbage mode used to be persisted verbatim and then
    // silently never match the 'unique'/'lock' comparisons at reaction time.
    const mode: ReactionRoleMode = optionalEnum(body, 'mode', ['normal', 'unique', 'lock'] as const) ?? 'normal';
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
    // Same limits and role/emoji checks as /reaction-role create + add, so the
    // API can't save a menu Discord won't react to or a role the bot can't grant.
    const tl = lang.reactionRole;
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length > MAX.REACTION_ROLE_OPTIONS) throw ApiError.badRequest(tl.add.maxOptions);
    if ((await menuRepo.count({ where: { guildId } })) >= MAX.REACTION_ROLE_MENUS) {
      throw ApiError.badRequest(tl.create.maxMenus);
    }
    const botHighest = rawOptions.length > 0 ? (await guild.members.fetchMe()).roles.highest.position : 0;
    const seenEmoji = new Set<string>();
    const options: ReactionRoleOption[] = rawOptions.map((raw, idx) => {
      const opt = (raw ?? {}) as { emoji?: unknown; roleId?: unknown; label?: unknown };
      const emoji = typeof opt.emoji === 'string' ? opt.emoji.trim() : '';
      const roleId = typeof opt.roleId === 'string' ? opt.roleId : '';
      if (!emoji) throw ApiError.badRequest(`options[${idx}]: emoji is required`);
      if (!validateEmoji(emoji).valid) throw ApiError.badRequest(`options[${idx}]: ${tl.add.invalidEmoji}`);
      // Same identity as the reaction lookup: two spellings of one custom emoji would collide there
      const emojiKey = optionEmojiKey(emoji);
      if (seenEmoji.has(emojiKey)) throw ApiError.badRequest(`options[${idx}]: duplicate emoji`);
      seenEmoji.add(emojiKey);
      if (!isValidSnowflake(roleId)) throw ApiError.badRequest(`options[${idx}]: invalid roleId`);
      const role = guild.roles.cache.get(roleId);
      if (!role) throw ApiError.badRequest(`options[${idx}]: role not found`);
      const roleCheck = validateRoleForMenu(role, guild, botHighest);
      if (!roleCheck.valid) throw ApiError.badRequest(`options[${idx}]: ${roleCheck.error}`);
      const label = typeof opt.label === 'string' ? opt.label : null;
      return optionRepo.create({ emoji, roleId, description: label, sortOrder: idx });
    });
    menu.options = options;

    // The BFF only checks Manage Server, so judge each role by the dashboard user
    // (triggeredBy) as the slash command does; without one, refuse privileged roles
    const actorId = optionalString(body, 'triggeredBy');
    const actor = actorId && isValidSnowflake(actorId) ? await guild.members.fetch(actorId).catch(() => null) : null;
    for (const [idx, opt] of options.entries()) {
      const role = guild.roles.cache.get(opt.roleId)!;
      const check = actor
        ? await validateAssignableRole({ guild, user: { id: actor.id }, memberPermissions: actor.permissions }, role)
        : { valid: !hasPrivilegedPermissions(role), error: lang.errors.assignableRole.privileged };
      if (!check.valid) throw ApiError.badRequest(`options[${idx}]: ${check.error}`);
    }

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
    const menu = await getAndValidateEntity(url, 'reaction-roles', menuRepo, guildId, {
      notFoundMessage: 'Menu not found',
      relations: { options: true },
    });

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const success = await updateMenuMessage(menu, guild);
    if (!success) throw ApiError.badRequest('Failed to rebuild menu message');

    invalidateGuildMenuCache(guildId);

    await writeAuditAction(guildId, body, 'reactionRole.rebuild', {
      menuId: menu.id,
    });
    return { success: true };
  });
}
