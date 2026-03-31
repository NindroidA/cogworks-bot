/**
 * Maintenance Handlers — GET /internal/maintenance
 *
 * Returns whether the bot is in maintenance mode.
 * Works in both full mode and maintenance mode.
 */

import type { Client } from 'discord.js';
import { version } from '../../../../package.json';
import type { RouteHandler } from '../router';

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const bootTime = new Date();

export function registerMaintenanceHandlers(_client: Client, routes: Map<string, RouteHandler>): void {
  routes.set('GET /internal/maintenance', async () => {
    if (MAINTENANCE_MODE) {
      return {
        active: true,
        startedAt: bootTime.toISOString(),
        version,
      };
    }

    return { active: false };
  });
}
