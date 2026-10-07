import type { Client, GuildTextBasedChannel } from 'discord.js';
import { fmt, lang } from '../../../lang';
import { RulesConfig } from '../../../typeorm/entities/rules/RulesConfig';
import { lazyRepo } from '../../database/lazyRepo';
import { verifiedMessageDelete } from '../../discord/verifiedDelete';
import { invalidateRulesCache } from '../../rules/rulesCache';
import { cleanupOldMessage } from '../../setup/messageGuard';
import { validateEmoji } from '../../validation/validators';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditAction } from './auditHelper';

const rulesConfigRepo = lazyRepo(RulesConfig);

/** Discord's per-message content limit */
const MESSAGE_MAX = 2000;

/** Discord 50001 Missing Access / 50013 Missing Permissions */
function isMissingPermission(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 50001 || code === 50013;
}

export function registerRulesHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/rules/setup
  //
  // The dashboard saves the rules config itself (PUT /rules writes the row)
  // and then sends only { triggeredBy }, so every field falls back to the
  // stored row. Validation matches /rules setup and runs before any Discord write.
  routes.set('POST /rules/setup', async (guildId, body) => {
    const tl = lang.rules.setup;
    const stored = await rulesConfigRepo.findOneBy({ guildId });

    const channelId = optionalString(body, 'channelId') ?? stored?.channelId;
    const roleId = optionalString(body, 'roleId') ?? stored?.roleId;
    if (!channelId) throw ApiError.badRequest('channelId is required (save the rules config first)');
    if (!roleId) throw ApiError.badRequest('roleId is required (save the rules config first)');
    if (!isValidSnowflake(channelId)) throw ApiError.badRequest('Invalid channelId format');
    if (!isValidSnowflake(roleId)) throw ApiError.badRequest('Invalid roleId format');

    const emoji = optionalString(body, 'emoji') ?? stored?.emoji ?? '✅';
    if (!validateEmoji(emoji).valid) throw ApiError.badRequest(tl.invalidEmoji);
    const customMessage = optionalString(body, 'messageContent') ?? stored?.customMessage ?? null;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      throw ApiError.notFound('Channel not found or not a text channel');
    }

    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) throw ApiError.notFound('Role not found');
    if (role.id === guild.id) throw ApiError.badRequest(tl.cannotUseEveryone);
    if (role.managed) throw ApiError.badRequest(tl.cannotUseManagedRole);
    const botMember = await guild.members.fetchMe();
    if (role.position >= botMember.roles.highest.position) throw ApiError.badRequest(tl.roleTooHigh);

    const messageText = customMessage || fmt(tl.defaultMessage, { emoji, roleName: role.name });
    if (messageText.length > MESSAGE_MAX) {
      throw ApiError.badRequest(`Rules message must be at most ${MESSAGE_MAX} characters`);
    }

    const rulesMessage = await (channel as GuildTextBasedChannel).send({ content: messageText }).catch(error => {
      if (isMissingPermission(error)) {
        throw ApiError.forbidden('The bot is missing permission to send messages in that channel');
      }
      throw error;
    });
    // Don't leave a rules message behind that nobody can react to or that isn't saved
    const discardPost = () => verifiedMessageDelete(rulesMessage, { guildId, label: 'unsaved rules message' });
    try {
      await rulesMessage.react(emoji);
    } catch (error) {
      await discardPost();
      if (isMissingPermission(error)) {
        throw ApiError.forbidden('The bot is missing the Add Reactions permission in that channel');
      }
      throw ApiError.badRequest('Could not add the reaction; check the emoji');
    }

    const previous = stored ? { channelId: stored.channelId, messageId: stored.messageId } : null;
    const config = stored ?? rulesConfigRepo.create({ guildId });
    config.channelId = channelId;
    config.messageId = rulesMessage.id;
    config.roleId = roleId;
    config.emoji = emoji;
    // null = default text, as the slash command stores it
    config.customMessage = customMessage;
    try {
      await rulesConfigRepo.save(config);
    } catch (error) {
      await discardPost();
      throw error;
    }

    // Re-post: remove the old message only once the new one is live and saved
    if (previous?.messageId && previous.messageId !== rulesMessage.id) {
      await cleanupOldMessage(guild, previous.channelId, previous.messageId);
    }

    invalidateRulesCache(guildId);

    await writeAuditAction(guildId, body, 'rules.setup', {
      messageId: rulesMessage.id,
    });
    return { success: true, messageId: rulesMessage.id };
  });
}
