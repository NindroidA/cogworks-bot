import type {
  Client,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import { AppDataSource } from '../typeorm';
import { RulesConfig } from '../typeorm/entities/rules';
import { enhancedLogger, LogCategory, lang } from '../utils';
import { ReactionCooldown } from '../utils/reactionCooldown';

const rulesConfigRepo = AppDataSource.getRepository(RulesConfig);
const tl = lang.rules.reaction;

// TTL for cache entries (30 minutes)
const CACHE_TTL_MS = 30 * 60 * 1000;

// In-memory cache: Map<messageId, { config, cachedAt }>
const rulesCache = new Map<string, { config: RulesConfig; cachedAt: number }>();

const cooldown = new ReactionCooldown();

/** Stop the rules cooldown cleanup interval (call on shutdown) */
export function stopRulesCooldownCleanup(): void {
  cooldown.stop();
}

/** Clear cache for a guild (called on setup/remove/guild leave) */
export function invalidateRulesCache(guildId: string): void {
  for (const [messageId, entry] of rulesCache) {
    if (entry.config.guildId === guildId) {
      rulesCache.delete(messageId);
    }
  }
}

/** Lookup rules config by message ID with caching */
async function getRulesConfig(messageId: string, guildId: string): Promise<RulesConfig | null> {
  // Check cache first — verify guildId matches to prevent cross-guild leaks
  const cached = rulesCache.get(messageId);
  if (cached) {
    // Check TTL — evict stale entries
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
      rulesCache.delete(messageId);
    } else if (cached.config.guildId === guildId) {
      return cached.config;
    }
    // Cache hit but wrong guild — ignore and fall through to DB
  }

  // DB lookup
  const config = await rulesConfigRepo.findOneBy({ guildId, messageId });
  if (config) {
    rulesCache.set(messageId, { config, cachedAt: Date.now() });
  }
  return config;
}

/** Handle reaction add — assign role */
export async function handleRulesReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  _client: Client,
): Promise<void> {
  // Ignore bot reactions
  if (user.bot) return;
  if (cooldown.isOnCooldown(user.id, reaction.message.id)) return;

  try {
    // Fetch partials if needed
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
    const config = await getRulesConfig(message.id, guildId);
    if (!config) return;

    // Check if the emoji matches
    const reactionEmoji = reaction.emoji.name || reaction.emoji.toString();
    if (reactionEmoji !== config.emoji && reaction.emoji.toString() !== config.emoji) return;

    // Assign the role
    const member = await message.guild.members.fetch(user.id);
    const role = message.guild.roles.cache.get(config.roleId);

    if (!role) {
      enhancedLogger.warn(tl.roleNotFound, LogCategory.SYSTEM, {
        guildId,
        roleId: config.roleId,
        userId: user.id,
      });
      return;
    }

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role);
      enhancedLogger.debug(tl.roleAssigned, LogCategory.SYSTEM, {
        guildId,
        userId: user.id,
        roleId: role.id,
      });
    }
  } catch (error) {
    enhancedLogger.error(tl.assignError, error as Error, LogCategory.SYSTEM, {
      userId: user.id,
      messageId: reaction.message.id,
    });
  }
}

/** Handle reaction remove — remove role */
export async function handleRulesReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  _client: Client,
): Promise<void> {
  // Ignore bot reactions
  if (user.bot) return;
  if (cooldown.isOnCooldown(user.id, reaction.message.id)) return;

  try {
    // Fetch partials if needed
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
    const config = await getRulesConfig(message.id, guildId);
    if (!config) return;

    // Check if the emoji matches
    const reactionEmoji = reaction.emoji.name || reaction.emoji.toString();
    if (reactionEmoji !== config.emoji && reaction.emoji.toString() !== config.emoji) return;

    // Remove the role
    const member = await message.guild.members.fetch(user.id);
    const role = message.guild.roles.cache.get(config.roleId);

    if (!role) {
      enhancedLogger.warn(tl.roleNotFound, LogCategory.SYSTEM, {
        guildId,
        roleId: config.roleId,
        userId: user.id,
      });
      return;
    }

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      enhancedLogger.debug(tl.roleRemoved, LogCategory.SYSTEM, {
        guildId,
        userId: user.id,
        roleId: role.id,
      });
    }
  } catch (error) {
    enhancedLogger.error(tl.removeError, error as Error, LogCategory.SYSTEM, {
      userId: user.id,
      messageId: reaction.message.id,
    });
  }
}
