import type { Client, TextChannel } from 'discord.js';
import { invalidateRulesCache } from '../../../events/rulesReaction';
import { RulesConfig } from '../../../typeorm/entities/rules/RulesConfig';
import { lazyRepo } from '../../database/lazyRepo';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalString, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const rulesConfigRepo = lazyRepo(RulesConfig);

export function registerRulesHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/rules/setup
  routes.set('POST /rules/setup', async (guildId, body) => {
    const channelId = requireString(body, 'channelId');
    const messageContent = requireString(body, 'messageContent');
    const roleId = requireString(body, 'roleId');
    if (!isValidSnowflake(channelId)) throw ApiError.badRequest('Invalid channelId format');
    if (!isValidSnowflake(roleId)) throw ApiError.badRequest('Invalid roleId format');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw ApiError.notFound('Channel not found or not a text channel');
    }

    const emoji = optionalString(body, 'emoji') ?? '✅';

    // Post rules message
    const rulesMessage = await (channel as TextChannel).send(messageContent);
    await rulesMessage.react(emoji);

    // Save or update config
    let config = await rulesConfigRepo.findOneBy({ guildId });
    if (!config) {
      config = rulesConfigRepo.create({
        guildId,
        channelId,
        messageId: rulesMessage.id,
        roleId,
        emoji,
        customMessage: messageContent,
      });
    } else {
      config.channelId = channelId;
      config.messageId = rulesMessage.id;
      config.roleId = roleId;
      config.emoji = emoji;
      config.customMessage = messageContent;
    }
    await rulesConfigRepo.save(config);

    // Invalidate cache
    invalidateRulesCache(guildId);

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'rules.setup', triggeredBy, {
      messageId: rulesMessage.id,
    });
    return { success: true, messageId: rulesMessage.id };
  });
}
