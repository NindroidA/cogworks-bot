import type { Client } from 'discord.js';
import { MoreThanOrEqual } from 'typeorm';
import { DEFAULT_KEYWORDS } from '../../../commands/handlers/baitChannel/keywords';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelLog } from '../../../typeorm/entities/BaitChannelLog';
import { BaitKeyword } from '../../../typeorm/entities/bait/BaitKeyword';
import { JoinEvent } from '../../../typeorm/entities/bait/JoinEvent';
import type { BaitChannelManager } from '../../baitChannelManager';
import { ApiError } from '../apiError';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

type ClientWithBaitManager = Client & {
  baitChannelManager?: BaitChannelManager;
};

import { MAX } from '../../constants';

export function registerBaitChannelHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
): void {
  const keywordRepo = AppDataSource.getRepository(BaitKeyword);

  // GET /internal/guilds/:guildId/bait-channel/keywords
  routes.set('GET /bait-channel/keywords', async guildId => {
    const keywords = await keywordRepo.find({
      where: { guildId },
      order: { weight: 'DESC' },
    });
    return { keywords };
  });

  // POST /internal/guilds/:guildId/bait-channel/keywords/add
  routes.set('POST /bait-channel/keywords/add', async (guildId, body) => {
    const keyword = (body.keyword as string)?.toLowerCase().trim();
    const weight = typeof body.weight === 'number' ? body.weight : 5;
    const triggeredBy = body.triggeredBy as string | undefined;

    if (!keyword || keyword.length < 1 || keyword.length > 100) {
      throw ApiError.badRequest('keyword must be 1-100 characters');
    }
    if (weight < 1 || weight > 10) {
      throw ApiError.badRequest('weight must be between 1 and 10');
    }

    const count = await keywordRepo.count({ where: { guildId } });
    if (count >= MAX.BAIT_KEYWORDS_PER_GUILD) {
      throw ApiError.conflict('Maximum 50 keywords reached');
    }

    const existing = await keywordRepo.findOne({ where: { guildId, keyword } });
    if (existing) {
      throw ApiError.conflict(`Keyword '${keyword}' already exists`);
    }

    await keywordRepo.save(
      keywordRepo.create({
        guildId,
        keyword,
        weight,
        createdBy: triggeredBy || 'dashboard',
      }),
    );

    const baitManager = (client as ClientWithBaitManager).baitChannelManager;
    baitManager?.clearKeywordCache(guildId);

    await writeAuditLog(guildId, 'bait-keyword-add', triggeredBy, {
      keyword,
      weight,
    });

    return { success: true, keyword, weight };
  });

  // POST /internal/guilds/:guildId/bait-channel/keywords/remove
  routes.set('POST /bait-channel/keywords/remove', async (guildId, body) => {
    const keyword = (body.keyword as string)?.toLowerCase().trim();
    const triggeredBy = body.triggeredBy as string | undefined;

    if (!keyword) {
      throw ApiError.badRequest('keyword is required');
    }

    const result = await keywordRepo.delete({ guildId, keyword });
    if (!result.affected) {
      throw ApiError.notFound('Keyword not found');
    }

    const baitManager = (client as ClientWithBaitManager).baitChannelManager;
    baitManager?.clearKeywordCache(guildId);

    await writeAuditLog(guildId, 'bait-keyword-remove', triggeredBy, {
      keyword,
    });

    return { success: true };
  });

  // POST /internal/guilds/:guildId/bait-channel/keywords/reset
  routes.set('POST /bait-channel/keywords/reset', async (guildId, body) => {
    const triggeredBy = body.triggeredBy as string | undefined;

    await keywordRepo.delete({ guildId });

    const entities = DEFAULT_KEYWORDS.map(k =>
      keywordRepo.create({
        guildId,
        keyword: k.keyword,
        weight: k.weight,
        createdBy: 'system',
      }),
    );
    await keywordRepo.save(entities);

    const baitManager = (client as ClientWithBaitManager).baitChannelManager;
    baitManager?.clearKeywordCache(guildId);

    await writeAuditLog(guildId, 'bait-keyword-reset', triggeredBy);

    return { success: true, count: DEFAULT_KEYWORDS.length };
  });

  const logRepo = AppDataSource.getRepository(BaitChannelLog);
  const joinEventRepo = AppDataSource.getRepository(JoinEvent);

  // POST /internal/guilds/:guildId/bait-channel/override
  // Mark the most recent BaitChannelLog for a user as overridden
  routes.set('POST /bait-channel/override', async (guildId, body) => {
    const userId = body.userId as string | undefined;
    const triggeredBy = body.triggeredBy as string | undefined;

    if (!userId) {
      throw ApiError.badRequest('userId is required');
    }

    const log = await logRepo.findOne({
      where: { guildId, userId },
      order: { createdAt: 'DESC' },
    });

    if (!log) {
      throw ApiError.notFound('No log entry found for this user');
    }

    if (log.overridden) {
      throw ApiError.conflict('Log entry is already overridden');
    }

    log.overridden = true;
    log.overriddenBy = triggeredBy || 'dashboard';
    log.overriddenAt = new Date();
    await logRepo.save(log);

    await writeAuditLog(guildId, 'bait-log-override', triggeredBy, {
      logId: log.id,
      userId,
    });

    return { success: true, logId: log.id };
  });

  // GET /internal/guilds/:guildId/bait-channel/stats?days=30
  // Return detection statistics for the last N days
  routes.set('GET /bait-channel/stats', async (guildId, _body, url) => {
    const urlObj = new URL(url, 'http://localhost');
    const days = Math.min(Math.max(Number(urlObj.searchParams.get('days')) || 30, 1), 365);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const logs = await logRepo.find({
      where: {
        guildId,
        createdAt: MoreThanOrEqual(since),
      },
      order: { createdAt: 'DESC' },
    });

    const total = logs.length;

    // Action breakdown
    const actionBreakdown: Record<string, number> = {};
    for (const log of logs) {
      actionBreakdown[log.actionTaken] = (actionBreakdown[log.actionTaken] || 0) + 1;
    }

    // Override rate
    const overriddenCount = logs.filter(l => l.overridden).length;
    const overrideRate = total > 0 ? Math.round((overriddenCount / total) * 100) : 0;

    // Score distribution (buckets of 10)
    const scoreDistribution: Record<string, number> = {
      '0-9': 0,
      '10-19': 0,
      '20-29': 0,
      '30-39': 0,
      '40-49': 0,
      '50-59': 0,
      '60-69': 0,
      '70-79': 0,
      '80-89': 0,
      '90-100': 0,
    };
    for (const log of logs) {
      const score = log.suspicionScore || 0;
      if (score >= 90) scoreDistribution['90-100']++;
      else {
        const bucket = `${Math.floor(score / 10) * 10}-${Math.floor(score / 10) * 10 + 9}`;
        if (bucket in scoreDistribution) scoreDistribution[bucket]++;
      }
    }

    // Top detection flags
    const flagCounts: Record<string, number> = {};
    for (const log of logs) {
      if (log.detectionFlags) {
        for (const [flag, triggered] of Object.entries(log.detectionFlags)) {
          if (triggered) {
            flagCounts[flag] = (flagCounts[flag] || 0) + 1;
          }
        }
      }
    }
    const topFlags = Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([flag, count]) => ({ flag, count }));

    return {
      days,
      total,
      actionBreakdown,
      overrideRate,
      overriddenCount,
      scoreDistribution,
      topFlags,
    };
  });

  // GET /internal/guilds/:guildId/bait-channel/join-events?limit=50
  // Return recent join events with burst status
  routes.set('GET /bait-channel/join-events', async (guildId, _body, url) => {
    const urlObj = new URL(url, 'http://localhost');
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 50, 1), 200);

    const events = await joinEventRepo.find({
      where: { guildId },
      order: { joinedAt: 'DESC' },
      take: limit,
    });

    return { joinEvents: events, count: events.length };
  });
}
