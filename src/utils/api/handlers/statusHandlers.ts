/**
 * Status Handlers — GET/POST/DELETE /internal/status
 *
 * Exposes bot status and global presence override for the webapp dashboard.
 * Only works in full mode (not maintenance mode).
 */

import type { Client } from 'discord.js';
import { version } from '../../../../package.json';
import { AppDataSource } from '../../../typeorm';
import { StatusIncident, type StatusLevel } from '../../../typeorm/entities/status';
import type { StatusManager } from '../../status/statusManager';
import { ApiError } from '../apiError';
import { optionalString, requireString } from '../helpers';
import type { RouteHandler } from '../router';

const VALID_LEVELS: StatusLevel[] = ['operational', 'degraded', 'partial-outage', 'major-outage', 'maintenance'];

export function registerStatusHandlers(
  client: Client,
  statusManager: StatusManager,
  routes: Map<string, RouteHandler>,
): void {
  // GET /internal/status — current bot status + presence info
  routes.set('GET /internal/status', async () => {
    const status = await statusManager.getStatus();

    const presenceActivity = client.user?.presence?.activities?.[0];

    return {
      level: status.level,
      message: status.message,
      presenceText: presenceActivity?.state ?? null,
      isOverride: status.isManualOverride && statusManager.isManualOverrideActive(status),
      overrideExpiresAt: status.manualOverrideExpiresAt?.toISOString() ?? null,
      uptime: process.uptime(),
      guilds: client.guilds.cache.size,
      version,
    };
  });

  // POST /internal/status/override — set a fixed presence + optional status level
  routes.set('POST /internal/status/override', async (_guildId, body) => {
    const message = requireString(body, 'message');
    const levelStr = optionalString(body, 'level') ?? 'operational';

    if (!VALID_LEVELS.includes(levelStr as StatusLevel)) {
      throw ApiError.badRequest(`Invalid level. Must be one of: ${VALID_LEVELS.join(', ')}`);
    }

    const level = levelStr as StatusLevel;

    // Use 'bot-api' as the userId for API-triggered overrides
    const status = await statusManager.setStatus(level, 'bot-api', message);

    const presenceActivity = client.user?.presence?.activities?.[0];

    return {
      level: status.level,
      message: status.message,
      presenceText: presenceActivity?.state ?? null,
      isOverride: true,
      overrideExpiresAt: status.manualOverrideExpiresAt?.toISOString() ?? null,
    };
  });

  // DELETE /internal/status/override — clear override, resume rotation
  routes.set('DELETE /internal/status/override', async () => {
    const status = await statusManager.clearStatus('bot-api');

    const presenceActivity = client.user?.presence?.activities?.[0];

    return {
      level: status.level,
      message: status.message,
      presenceText: presenceActivity?.state ?? null,
      isOverride: false,
    };
  });

  // GET /internal/status/history — past status incidents
  routes.set('GET /internal/status/history', async (_guildId, _body, url) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const limit = Math.min(Number.parseInt(params.get('limit') || '20', 10), 50);

    const incidents = await AppDataSource.getRepository(StatusIncident).find({
      order: { startedAt: 'DESC' },
      take: limit,
    });

    return {
      incidents: incidents.map(i => {
        const startMs = new Date(i.startedAt).getTime();
        const endMs = i.resolvedAt ? new Date(i.resolvedAt).getTime() : Date.now();
        return {
          level: i.level,
          message: i.message,
          startedAt: i.startedAt,
          clearedAt: i.resolvedAt,
          durationSeconds: Math.round((endMs - startMs) / 1000),
          affectedSystems: i.affectedSystems,
        };
      }),
    };
  });
}
