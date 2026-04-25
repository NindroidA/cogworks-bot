import type { Client } from 'discord.js';
import type { BaitChannelManager } from '../../baitChannel/baitChannelManager';
import { invalidateGuildMenuCache } from '../../reactionRole/menuCache';
import { invalidateRulesCache } from '../../rules/rulesCache';
import { optionalString, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

type ClientWithBaitManager = Client & {
  baitChannelManager?: BaitChannelManager;
};

export function registerConfigHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/config/refresh
  routes.set('POST /config/refresh', async (guildId, body) => {
    const configType = requireString(body, 'configType');

    switch (configType) {
      case 'baitChannel': {
        const baitManager = (client as ClientWithBaitManager).baitChannelManager;
        baitManager?.clearConfigCache(guildId);
        break;
      }
      case 'reactionRole':
        invalidateGuildMenuCache(guildId);
        break;
      case 'rules':
        invalidateRulesCache(guildId);
        break;
      default:
        // No cache to invalidate for ticket, memory, application, announcement, etc.
        break;
    }

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'config.refresh', triggeredBy, {
      configType,
    });

    return { success: true, configType };
  });
}
