import type { Client } from 'discord.js';
import type { BaitChannelManager } from '../../baitChannel/baitChannelManager';
import { invalidateGuildMenuCache } from '../../reactionRole/menuCache';
import { invalidateRulesCache } from '../../rules/rulesCache';
import { requestGuildCommandRefresh } from '../../setup/commandGating';
import { requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditAction } from './auditHelper';

type ClientWithBaitManager = Client & {
  baitChannelManager?: BaitChannelManager;
};

/** @param requestRefresh Injectable for tests (same reason as registerTicketHandlers' archive fake). */
export function registerConfigHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
  requestRefresh: (guildId: string) => void = requestGuildCommandRefresh,
): void {
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

    // Dashboard writes go straight to the DB, so a bait `enabled` toggle or a
    // first memory/announcement config can change which gated commands the
    // guild should see. Debounced, and a no-op when the module set is unchanged.
    requestRefresh(guildId);

    await writeAuditAction(guildId, body, 'config.refresh', {
      configType,
    });

    return { success: true, configType };
  });
}
