import type { Client } from 'discord.js';
import { invalidateRulesCache } from '../../../events/rulesReaction';
import type { BaitChannelManager } from '../../baitChannel/baitChannelManager';
import { invalidateGuildMenuCache } from '../../reactionRole/menuCache';
import { requireString } from '../helpers';
import type { RouteHandler } from '../router';

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

    return { success: true, configType };
  });
}
