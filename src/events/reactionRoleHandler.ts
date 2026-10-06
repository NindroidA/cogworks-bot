import type { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { DiscordAPIError, Routes } from 'discord.js';
import type { ReactionRoleOption } from '../typeorm/entities/reactionRole';
import { enhancedLogger, fetchPartial, LogCategory, lang } from '../utils';
import { ReactionCooldown } from '../utils/reactionCooldown';
import { getCachedMenu, getOptionByEmoji } from '../utils/reactionRole/menuCache';
import { reactionRouteIdentifier } from '../utils/reactionRole/optionEmoji';

const tl = lang.reactionRole.reaction;

const cooldown = new ReactionCooldown();

/** Stop the reaction role cooldown cleanup interval (call on shutdown) */
export function stopReactionRoleCooldownCleanup(): void {
  cooldown.stop();
}

/**
 * Cooldown key per message, option and direction. A shared add/remove key
 * dropped the opposite event (react then un-react within 2s left the role
 * on), and the reaction the bot clears in unique mode used up the user's
 * remove window for every option.
 */
function cooldownKey(messageId: string, optionId: number, direction: 'add' | 'remove'): string {
  return `${messageId}:${optionId}:${direction}`;
}

/**
 * Unique mode: take the user's reactions off the options they are switching
 * away from. Goes straight to REST because the client's reaction cache is
 * disabled (`message.reactions.cache` is always empty), and only targets
 * options whose role the member held, so a click costs one DELETE rather
 * than one per option on the tight reaction rate-limit bucket. Removing
 * someone else's reaction needs Manage Messages in the menu channel; without
 * it the DELETE fails with 50013, logged at warn so it shows up in the log.
 */
async function removeUserReactions(
  client: Client,
  reaction: MessageReaction | PartialMessageReaction,
  userId: string,
  options: ReactionRoleOption[],
  logContext: Record<string, unknown>,
): Promise<void> {
  const { channelId, id: messageId } = reaction.message;
  const results = await Promise.allSettled(
    options.map(opt =>
      client.rest.delete(
        Routes.channelMessageUserReaction(channelId, messageId, reactionRouteIdentifier(opt.emoji), userId),
      ),
    ),
  );
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    // 50013 = Missing Permissions
    if (result.reason instanceof DiscordAPIError && result.reason.code === 50013) {
      enhancedLogger.warn(
        'Unique mode could not remove a reaction: the bot needs Manage Messages in the menu channel',
        LogCategory.PERMISSION,
        { ...logContext, channelId },
      );
    } else {
      enhancedLogger.debug('Failed to remove reaction in unique mode', LogCategory.SYSTEM, {
        ...logContext,
        error: String(result.reason),
      });
    }
  }
}

/**
 * Handle reaction add for reaction role menus
 * Supports modes: normal, unique, lock
 */
export async function handleReactionRoleAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  client: Client,
): Promise<void> {
  if (user.bot) return;

  try {
    // Message id, guild and emoji are all present on a partial reaction, so
    // look the menu up first: reactions on other messages never cost a fetch.
    const message = reaction.message;
    if (!message.guild) return;

    const guildId = message.guild.id;
    const menu = await getCachedMenu(message.id, guildId);
    if (!menu) return;

    // Find matching emoji option (O(1) via pre-built index; custom emoji match by id)
    const option = getOptionByEmoji(message.id, reaction.emoji);
    if (!option) return;

    if (cooldown.isOnCooldown(user.id, cooldownKey(message.id, option.id, 'add'))) return;
    if (user.partial && !(await fetchPartial(user, 'user'))) return;

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
      // Options the user is switching away from, read before the role update. The member cache
      // only catches up with a previous click's role change on GUILD_MEMBER_UPDATE, so two very
      // fast clicks can miss a pick here and leave its reaction on the menu.
      const previousOptions = menu.options.filter(
        opt => opt.id !== option.id && opt.roleId !== role.id && member.roles.cache.has(opt.roleId),
      );

      // Batch role update: remove other menu roles and add the selected one in a single API call.
      // Removing the old reactions below fires remove events for those options. They are harmless:
      // the role is already gone, so the remove handler either finds no role to strip or, if the
      // event beats GUILD_MEMBER_UPDATE to the member cache, sends a redundant role DELETE, which
      // is idempotent.
      const menuRoleIds = new Set(menu.options.map(opt => opt.roleId));
      const newRoles = member.roles.cache.filter(r => !menuRoleIds.has(r.id));
      newRoles.set(role.id, role);
      await member.roles.set(newRoles);

      if (previousOptions.length > 0) {
        await removeUserReactions(client, reaction, user.id, previousOptions, {
          guildId,
          userId: user.id,
          menuId: menu.id,
        });
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

  try {
    // Menu + option lookup works on the partial reaction — no fetch needed
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

    // Find matching emoji option (O(1) via pre-built index; custom emoji match by id)
    const option = getOptionByEmoji(message.id, reaction.emoji);
    if (!option) return;

    if (cooldown.isOnCooldown(user.id, cooldownKey(message.id, option.id, 'remove'))) return;
    if (user.partial && !(await fetchPartial(user, 'user'))) return;

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
