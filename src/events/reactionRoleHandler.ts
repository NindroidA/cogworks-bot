import type { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { enhancedLogger, getCachedMenu, getOptionByEmoji, LogCategory, lang } from '../utils';
import { ReactionCooldown } from '../utils/reactionCooldown';

const tl = lang.reactionRole.reaction;

const cooldown = new ReactionCooldown();

/** Stop the reaction role cooldown cleanup interval (call on shutdown) */
export function stopReactionRoleCooldownCleanup(): void {
  cooldown.stop();
}

/**
 * Handle reaction add for reaction role menus
 * Supports modes: normal, unique, lock
 */
export async function handleReactionRoleAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  _client: Client,
): Promise<void> {
  if (user.bot) return;
  if (cooldown.isOnCooldown(user.id, reaction.message.id)) return;

  try {
    // Fetch partials
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (user.partial) {
      try {
        await user.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message;
    if (!message.guild) return;

    const guildId = message.guild.id;
    const menu = await getCachedMenu(message.id, guildId);
    if (!menu) return;

    // Find matching emoji option (O(1) via pre-built index)
    const reactionEmoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name || '';

    const option = getOptionByEmoji(message.id, reactionEmoji, reaction.emoji.name);
    if (!option) return;

    const member = await message.guild.members.fetch(user.id);
    const role = message.guild.roles.cache.get(option.roleId);

    if (!role) {
      enhancedLogger.warn(tl.roleNotFound, LogCategory.SYSTEM, {
        guildId,
        roleId: option.roleId,
        userId: user.id,
        menuId: menu.id,
      });
      return;
    }

    // Mode-specific logic
    if (menu.mode === 'unique') {
      // Batch role update: remove other menu roles and add the selected one in a single API call
      const menuRoleIds = new Set(menu.options.map(opt => opt.roleId));
      const newRoles = member.roles.cache.filter(r => !menuRoleIds.has(r.id));
      newRoles.set(role.id, role);
      await member.roles.set(newRoles);

      // Remove user's other reactions on this message (concurrent)
      const reactionRemovals: Promise<void>[] = [];
      for (const opt of menu.options) {
        if (opt.id === option.id) continue;
        const existingReaction = message.reactions.cache.find(r => {
          const emojiStr = r.emoji.id ? `<:${r.emoji.name}:${r.emoji.id}>` : r.emoji.name;
          return emojiStr === opt.emoji || r.emoji.name === opt.emoji;
        });
        if (existingReaction) {
          reactionRemovals.push(existingReaction.users.remove(user.id).then(() => {}));
        }
      }
      if (reactionRemovals.length > 0) {
        const results = await Promise.allSettled(reactionRemovals);
        for (const result of results) {
          if (result.status === 'rejected') {
            enhancedLogger.debug('Failed to remove reaction in unique mode', LogCategory.SYSTEM, {
              guildId,
              userId: user.id,
              menuId: menu.id,
              error: String(result.reason),
            });
          }
        }
      }

      enhancedLogger.debug(tl.roleAssigned, LogCategory.SYSTEM, {
        guildId,
        userId: user.id,
        roleId: role.id,
        menuId: menu.id,
        mode: menu.mode,
      });
    } else {
      // Assign the role (works for normal and lock modes)
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
        enhancedLogger.debug(tl.roleAssigned, LogCategory.SYSTEM, {
          guildId,
          userId: user.id,
          roleId: role.id,
          menuId: menu.id,
          mode: menu.mode,
        });
      }
    }
  } catch (error) {
    enhancedLogger.error(tl.assignError, error as Error, LogCategory.SYSTEM, {
      userId: user.id,
      messageId: reaction.message.id,
    });
  }
}

/**
 * Handle reaction remove for reaction role menus
 * Lock mode: ignores removal (role stays)
 */
export async function handleReactionRoleRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  _client: Client,
): Promise<void> {
  if (user.bot) return;
  if (cooldown.isOnCooldown(user.id, reaction.message.id)) return;

  try {
    // Fetch partials
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (user.partial) {
      try {
        await user.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message;
    if (!message.guild) return;

    const guildId = message.guild.id;
    const menu = await getCachedMenu(message.id, guildId);
    if (!menu) return;

    // Lock mode: do nothing on reaction remove
    if (menu.mode === 'lock') {
      enhancedLogger.debug(tl.lockModeIgnore, LogCategory.SYSTEM, {
        guildId,
        userId: user.id,
        menuId: menu.id,
      });
      return;
    }

    // Find matching emoji option (O(1) via pre-built index)
    const reactionEmoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name || '';

    const option = getOptionByEmoji(message.id, reactionEmoji, reaction.emoji.name);
    if (!option) return;

    const member = await message.guild.members.fetch(user.id);
    const role = message.guild.roles.cache.get(option.roleId);

    if (!role) {
      enhancedLogger.warn(tl.roleNotFound, LogCategory.SYSTEM, {
        guildId,
        roleId: option.roleId,
        userId: user.id,
        menuId: menu.id,
      });
      return;
    }

    // Remove the role (normal and unique modes)
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      enhancedLogger.debug(tl.roleRemoved, LogCategory.SYSTEM, {
        guildId,
        userId: user.id,
        roleId: role.id,
        menuId: menu.id,
        mode: menu.mode,
      });
    }
  } catch (error) {
    enhancedLogger.error(tl.removeError, error as Error, LogCategory.SYSTEM, {
      userId: user.id,
      messageId: reaction.message.id,
    });
  }
}
