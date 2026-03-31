import type { Client } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AuditLog } from '../../../typeorm/entities/AuditLog';
import { healthMonitor } from '../../monitoring/healthMonitor';
import { ApiError } from '../apiError';
import type { RouteHandler } from '../router';

export function registerGuildHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // GET /internal/guilds — list all guilds the bot is in
  routes.set('GET /internal/guilds', async () => {
    const guilds = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      memberCount: g.memberCount,
      joinedAt: g.joinedAt?.toISOString() || null,
    }));
    return { guilds };
  });

  // GET /internal/health — proxy health status
  routes.set('GET /internal/health', async () => {
    return (await healthMonitor.getHealthStatus()) as unknown as Record<string, unknown>;
  });

  // GET /internal/health/history — health snapshots for charting
  routes.set('GET /internal/health/history', async (_guildId, _body, url) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const hours = Math.min(Number.parseInt(params.get('hours') || '24', 10), 72);
    return { snapshots: healthMonitor.getHealthHistory(hours) };
  });

  // GET /internal/errors — recent bot errors
  routes.set('GET /internal/errors', async (_guildId, _body, url) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const limit = Math.min(Number.parseInt(params.get('limit') || '50', 10), 100);
    return { errors: healthMonitor.getRecentErrors(limit) };
  });

  // GET /internal/guilds/:guildId/members/:userId/permissions
  routes.set('GET /members/:userId/permissions', async (guildId, _body, url) => {
    const userIdMatch = url.match(/members\/(\d+)\/permissions/);
    if (!userIdMatch) throw ApiError.badRequest('Invalid URL');
    const userId = userIdMatch[1];

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw ApiError.notFound('Member not found');

    return {
      userId,
      guildId,
      permissions: member.permissions.bitfield.toString(),
      isAdmin: member.permissions.has('Administrator'),
      roles: member.roles.cache
        .filter(r => r.id !== guildId) // exclude @everyone
        .map(r => ({ id: r.id, name: r.name })),
    };
  });

  // GET /internal/guilds/:guildId/audit-log?limit=N
  routes.set('GET /audit-log', async (guildId, _body, url) => {
    const urlObj = new URL(url, 'http://localhost');
    const limitParam = Number(urlObj.searchParams.get('limit')) || 10;
    const limit = Math.min(Math.max(limitParam, 1), 50);

    const logs = await AppDataSource.getRepository(AuditLog).find({
      where: { guildId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return {
      logs: logs.map(log => ({
        id: log.id,
        action: log.action,
        triggeredBy: log.triggeredBy,
        source: log.source,
        details: log.details,
        createdAt: log.createdAt,
      })),
    };
  });

  // GET /internal/guilds/:guildId/channels
  routes.set('GET /channels', async guildId => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const channels = guild.channels.cache
      .filter(c => !c.isThread())
      .map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId,
        position: 'position' in c ? c.position : 0,
      }));

    return { channels };
  });

  // GET /internal/guilds/:guildId/roles
  routes.set('GET /roles', async guildId => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const roles = guild.roles.cache
      .filter(r => r.id !== guildId) // exclude @everyone
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        managed: r.managed,
        memberCount: r.members.size,
      }));

    return { roles };
  });

  // GET /internal/guilds/:guildId/members/search?query=&limit=
  routes.set('GET /members/search', async (guildId, _body, url) => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const urlObj = new URL(url, 'http://localhost');
    const query = urlObj.searchParams.get('query') || '';
    const limitParam = Number(urlObj.searchParams.get('limit')) || 10;
    const limit = Math.min(Math.max(limitParam, 1), 25);

    if (!query) return { members: [] };

    const fetched = await guild.members.search({ query, limit }).catch(() => null);
    if (!fetched) return { members: [] };

    const members = fetched.map(m => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName,
      avatar: m.user.avatar,
      roles: m.roles.cache.filter(r => r.id !== guildId).map(r => ({ id: r.id, name: r.name })),
    }));

    return { members };
  });
}
