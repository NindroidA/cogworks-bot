import type {
  Client,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import { enhancedLogger, getCachedMenu, LogCategory, lang } from '../utils';

const tl = lang.reactionRole.reaction;

// Per-user per-message cooldown (2 seconds) to prevent rapid reaction spam
const reactionCooldowns = new Map<string, number>();
const COOLDOWN_MS = 2000;

function isOnCooldown(userId: string, messageId: string): boolean {
  const key = `${userId}:${messageId}`;
  const lastTime = reactionCooldowns.get(key);
  const now = Date.now();
  if (lastTime && now - lastTime < COOLDOWN_MS) return true;
  reactionCooldowns.set(key, now);
  return false;
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
  if (isOnCooldown(user.id, reaction.message.id)) return;

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

    // Find matching emoji option
    const reactionEmoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name || '';

    const option = menu.options.find(
      o => o.emoji === reactionEmoji || o.emoji === reaction.emoji.name,
    );
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
      // Remove all other roles from this menu that the user has
      for (const opt of menu.options) {
        if (opt.id === option.id) continue;
        if (member.roles.cache.has(opt.roleId)) {
          const otherRole = message.guild.roles.cache.get(opt.roleId);
          if (otherRole) {
            await member.roles.remove(otherRole);
          }
        }
      }

      // Remove user's other reactions on this message
      for (const opt of menu.options) {
        if (opt.id === option.id) continue;
        const existingReaction = message.reactions.cache.find(r => {
          const emojiStr = r.emoji.id ? `<:${r.emoji.name}:${r.emoji.id}>` : r.emoji.name;
          return emojiStr === opt.emoji || r.emoji.name === opt.emoji;
        });
        if (existingReaction) {
          await existingReaction.users.remove(user.id);
        }
      }
    }

    // Assign the role (works for normal, unique, and lock modes)
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
  if (isOnCooldown(user.id, reaction.message.id)) return;

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

    // Find matching emoji option
    const reactionEmoji = reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name || '';

    const option = menu.options.find(
      o => o.emoji === reactionEmoji || o.emoji === reaction.emoji.name,
    );
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
