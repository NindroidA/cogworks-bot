import type { Client } from 'discord.js';
import { registerAnnouncementHandlers } from './handlers/announcementHandlers';
import { registerApplicationHandlers } from './handlers/applicationHandlers';
import { registerConfigHandlers } from './handlers/configHandlers';
import { registerGuildHandlers } from './handlers/guildHandlers';
import { registerMemoryHandlers } from './handlers/memoryHandlers';
import { registerReactionRoleHandlers } from './handlers/reactionRoleHandlers';
import { registerRulesHandlers } from './handlers/rulesHandlers';
import { registerTicketHandlers } from './handlers/ticketHandlers';

export type RouteHandler = (
  guildId: string,
  body: Record<string, unknown>,
  url: string,
) => Promise<Record<string, unknown>>;

export function registerHandlers(client: Client): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();

  // Top-level routes (no guildId required)
  registerGuildHandlers(client, routes);

  // Guild-scoped routes
  registerTicketHandlers(client, routes);
  registerApplicationHandlers(client, routes);
  registerAnnouncementHandlers(client, routes);
  registerMemoryHandlers(client, routes);
  registerRulesHandlers(client, routes);
  registerReactionRoleHandlers(client, routes);
  registerConfigHandlers(client, routes);

  return routes;
}
