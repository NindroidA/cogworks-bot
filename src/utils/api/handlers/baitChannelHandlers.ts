import type { Client } from 'discord.js';
import { IsNull, MoreThanOrEqual, Not } from 'typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../../../typeorm/entities/bait/BaitChannelLog';
import { BaitKeyword } from '../../../typeorm/entities/bait/BaitKeyword';
import { JoinEvent } from '../../../typeorm/entities/bait/JoinEvent';
import { PendingAction } from '../../../typeorm/entities/bait/PendingAction';
import type { BaitChannelManager } from '../../baitChannel/baitChannelManager';
import { DEFAULT_KEYWORDS } from '../../baitChannel/defaultKeywords';
import { getRaidModeManager } from '../../baitChannel/raidModeManager';
import { MAX } from '../../constants';
import { lazyRepo } from '../../database/lazyRepo';
import { requestGuildCommandRefresh } from '../../setup/commandGating';
import { ApiError } from '../apiError';
import { applyFields, type FieldDescriptor } from '../configFields';
import { isValidSnowflake, optionalNumber, optionalString, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

type ClientWithBaitManager = Client & {
  baitChannelManager?: BaitChannelManager;
};

const keywordRepo = lazyRepo(BaitKeyword);
const logRepo = lazyRepo(BaitChannelLog);
const joinEventRepo = lazyRepo(JoinEvent);
const configRepo = lazyRepo(BaitChannelConfig);
const pendingActionRepo = lazyRepo(PendingAction);

/**
 * Field map for `POST /bait-channel/config/update`. Numbers stay rangeless
 * except logRetentionDays (30-365). actionType is left as a free string for a
 * 1:1 port (the prior PATCH did no enum validation). Nullable strings accept
 * null/"" to clear; the appeal-link cross-field validation is handled
 * separately in the route after these are applied.
 */
export const BAIT_CONFIG_FIELDS: FieldDescriptor<BaitChannelConfig>[] = [
  { field: 'enabled', type: 'bool' },
  { field: 'enableSmartDetection', type: 'bool' },
  { field: 'requireVerification', type: 'bool' },
  { field: 'disableAdminWhitelist', type: 'bool' },
  { field: 'deleteUserMessages', type: 'bool' },
  { field: 'enableEscalation', type: 'bool' },
  { field: 'dmBeforeAction', type: 'bool' },
  { field: 'testMode', type: 'bool' },
  { field: 'enableWeeklySummary', type: 'bool' },
  { field: 'enableRaidMode', type: 'bool' },
  { field: 'enableAppealLink', type: 'bool' },
  { field: 'gracePeriodSeconds', type: 'int' },
  { field: 'instantActionThreshold', type: 'int' },
  { field: 'minAccountAgeDays', type: 'int' },
  { field: 'minMembershipMinutes', type: 'int' },
  { field: 'minMessageCount', type: 'int' },
  { field: 'deleteMessageHours', type: 'int' },
  { field: 'timeoutDurationMinutes', type: 'int' },
  { field: 'escalationLogThreshold', type: 'int' },
  { field: 'escalationTimeoutThreshold', type: 'int' },
  { field: 'escalationKickThreshold', type: 'int' },
  { field: 'escalationBanThreshold', type: 'int' },
  { field: 'joinVelocityThreshold', type: 'int' },
  { field: 'joinVelocityWindowMinutes', type: 'int' },
  { field: 'raidModeThreshold', type: 'int' },
  { field: 'raidModeWindowSeconds', type: 'int' },
  { field: 'crossChannelBurstThreshold', type: 'int' },
  { field: 'crossChannelBurstWindowSeconds', type: 'int' },
  { field: 'logRetentionDays', type: 'int', min: 30, max: 365 },
  { field: 'banReason', type: 'string' },
  { field: 'warningMessage', type: 'string' },
  { field: 'actionType', type: 'enum', values: ['ban', 'kick', 'timeout', 'log-only'] },
  { field: 'appealInfo', type: 'nullableString' },
  { field: 'logChannelId', type: 'nullableString' },
  { field: 'summaryChannelId', type: 'nullableString' },
  { field: 'raidModeAlertRoleId', type: 'nullableString' },
  { field: 'appealLinkBaseUrl', type: 'nullableString' },
];

export function registerBaitChannelHandlers(client: Client, routes: Map<string, RouteHandler>): void {
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
    const keyword = requireString(body, 'keyword').toLowerCase();
    const weight = optionalNumber(body, 'weight') ?? 5;
    const triggeredBy = optionalString(body, 'triggeredBy');

    if (keyword.length < 1 || keyword.length > 100) {
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

    await writeAuditLog(guildId, 'bait.keywordAdd', triggeredBy, {
      keyword,
      weight,
    });

    return { success: true, keyword, weight };
  });

  // POST /internal/guilds/:guildId/bait-channel/keywords/remove
  routes.set('POST /bait-channel/keywords/remove', async (guildId, body) => {
    const keyword = requireString(body, 'keyword').toLowerCase();
    const triggeredBy = optionalString(body, 'triggeredBy');

    const result = await keywordRepo.delete({ guildId, keyword });
    if (!result.affected) {
      throw ApiError.notFound('Keyword not found');
    }

    const baitManager = (client as ClientWithBaitManager).baitChannelManager;
    baitManager?.clearKeywordCache(guildId);

    await writeAuditLog(guildId, 'bait.keywordRemove', triggeredBy, {
      keyword,
    });

    return { success: true };
  });

  // POST /internal/guilds/:guildId/bait-channel/keywords/reset
  routes.set('POST /bait-channel/keywords/reset', async (guildId, body) => {
    const triggeredBy = optionalString(body, 'triggeredBy');

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

    await writeAuditLog(guildId, 'bait.keywordReset', triggeredBy);

    return { success: true, count: DEFAULT_KEYWORDS.length };
  });

  // POST /internal/guilds/:guildId/bait-channel/override
  // Mark the most recent BaitChannelLog for a user as overridden
  routes.set('POST /bait-channel/override', async (guildId, body) => {
    const userId = requireString(body, 'userId');
    const triggeredBy = optionalString(body, 'triggeredBy');

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

    await writeAuditLog(guildId, 'bait.logOverride', triggeredBy, {
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

  // ════════════════════════════════════════════════════════════════════
  // v3.2.0 endpoints — config CRUD, raid mode, pending actions, logs
  // ════════════════════════════════════════════════════════════════════

  // GET /internal/guilds/:guildId/bait-channel/config
  routes.set('GET /bait-channel/config', async guildId => {
    const config = await configRepo.findOne({ where: { guildId } });
    return { config: config ?? null };
  });

  // POST /internal/guilds/:guildId/bait-channel/config/update
  // Accepts any subset of writable fields. Validates types; rejects unknown
  // fields silently (forward-compat for webapp that may post stale shape).
  // (Was 'PATCH /bait-channel/config' — unreachable, since the internal API's
  // method gate only allows GET/POST/DELETE. ninsys-api writes bait config via
  // direct DB, so nothing called the old PATCH route.)
  routes.set('POST /bait-channel/config/update', async (guildId, body) => {
    const config = await configRepo.findOne({ where: { guildId } });
    if (!config) throw ApiError.notFound('Bait channel is not configured for this guild');

    const triggeredBy = optionalString(body, 'triggeredBy');
    // Per-field application is descriptor-driven (applyFields). Only the
    // logRetentionDays 30-365 range is enforced here; the other int fields stay
    // rangeless (1:1 with the prior behavior). String fields keep the
    // non-nullable / nullable split (the latter accept null/"" to clear).
    const patched = applyFields(config, body, BAIT_CONFIG_FIELDS);

    // Appeal-link safety. Two gates:
    //   1. Refuse to enable if base URL is HTTP (or unset).
    //   2. Refuse to enable if APPEAL_HMAC_SECRET is unset/too short —
    //      otherwise the signing call at runtime would throw and the
    //      whole DM path would degrade silently.
    if (config.enableAppealLink) {
      if (!config.appealLinkBaseUrl) {
        throw ApiError.badRequest('appealLinkBaseUrl must be set when enableAppealLink=true');
      }
      try {
        const url = new URL(config.appealLinkBaseUrl);
        if (url.protocol !== 'https:') {
          throw ApiError.badRequest('appealLinkBaseUrl must be https');
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw ApiError.badRequest('appealLinkBaseUrl is not a valid URL');
      }
      const secret = process.env.APPEAL_HMAC_SECRET;
      if (!secret || secret.length < 16) {
        throw ApiError.badRequest(
          'APPEAL_HMAC_SECRET env is missing or too short; cannot enable appeal links until the deployment is configured',
        );
      }
    }

    await configRepo.save(config);

    // Invalidate the in-process cache so the next bait-message picks up the
    // new config.
    const baitManager = (client as ClientWithBaitManager).baitChannelManager;
    baitManager?.clearConfigCache(guildId);

    // If the webapp toggled the module on/off, refresh the guild's commands.
    if (patched.includes('enabled')) requestGuildCommandRefresh(guildId);

    await writeAuditLog(guildId, 'bait.configUpdate', triggeredBy, { patched });

    return { success: true, patched };
  });

  // GET /internal/guilds/:guildId/bait-channel/raid-mode/status
  routes.set('GET /bait-channel/raid-mode/status', async guildId => {
    const mgr = getRaidModeManager();
    if (!mgr)
      return {
        active: false,
        until: null,
        triggerCount: 0,
        recentOffenderIds: [],
      };
    return mgr.getStatus(guildId);
  });

  // POST /internal/guilds/:guildId/bait-channel/raid-mode/enter
  routes.set('POST /bait-channel/raid-mode/enter', async (guildId, body) => {
    const triggeredBy = optionalString(body, 'triggeredBy') ?? 'dashboard';
    const reason = optionalString(body, 'reason');
    const mgr = getRaidModeManager();
    if (!mgr) throw ApiError.conflict('Raid mode manager is not initialized');
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) throw ApiError.notFound('Guild not accessible to the bot');
    const config = await configRepo.findOne({ where: { guildId } });
    if (!config) throw ApiError.notFound('Bait channel is not configured for this guild');
    if (config.currentRaidModeUntil && config.currentRaidModeUntil.getTime() > Date.now()) {
      throw ApiError.conflict('Raid mode is already active');
    }
    await mgr.enterRaidMode(guild, config);
    await writeAuditLog(guildId, 'bait.raidModeEnter', triggeredBy, { reason });
    return { success: true, enteredAt: new Date().toISOString() };
  });

  // POST /internal/guilds/:guildId/bait-channel/raid-mode/release
  routes.set('POST /bait-channel/raid-mode/release', async (guildId, body) => {
    const triggeredBy = optionalString(body, 'triggeredBy') ?? 'dashboard';
    const reason = optionalString(body, 'reason');
    const mgr = getRaidModeManager();
    if (!mgr) throw ApiError.conflict('Raid mode manager is not initialized');
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) throw ApiError.notFound('Guild not accessible to the bot');
    const released = await mgr.releaseRaidMode(guild, triggeredBy, reason);
    if (released) {
      await writeAuditLog(guildId, 'bait.raidModeRelease', triggeredBy, {
        reason,
      });
    }
    return { success: true, released };
  });

  // GET /internal/guilds/:guildId/bait-channel/pending-actions?status=active|dead|all
  routes.set('GET /bait-channel/pending-actions', async (guildId, _body, url) => {
    const urlObj = new URL(url, 'http://localhost');
    const status = urlObj.searchParams.get('status') ?? 'active';
    if (!['active', 'dead', 'all'].includes(status)) {
      throw ApiError.badRequest('status must be one of: active, dead, all');
    }
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 50, 1), 200);

    const where: Record<string, unknown> = { guildId };
    if (status === 'active') where.deadAt = IsNull();
    else if (status === 'dead') where.deadAt = Not(IsNull());
    // status === 'all' → no deadAt filter

    const rows = await pendingActionRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return { pendingActions: rows, count: rows.length };
  });

  // POST /internal/guilds/:guildId/bait-channel/pending-actions/cancel
  // body: { id: number, reason?: string }
  routes.set('POST /bait-channel/pending-actions/cancel', async (guildId, body) => {
    const triggeredBy = optionalString(body, 'triggeredBy') ?? 'dashboard';
    const id = optionalNumber(body, 'id');
    if (id === undefined) throw ApiError.badRequest('id is required');
    const row = await pendingActionRepo.findOne({ where: { guildId, id } });
    if (!row) throw ApiError.notFound('Pending action not found');
    await pendingActionRepo.remove(row);
    await writeAuditLog(guildId, 'bait.pendingActionCancel', triggeredBy, {
      pendingActionId: id,
      userId: row.userId,
      action: row.action,
    });
    return { success: true };
  });

  // GET /internal/guilds/:guildId/bait-channel/logs
  // ?days=N&action=X&userId=Y&overridden=true|false&limit=N
  routes.set('GET /bait-channel/logs', async (guildId, _body, url) => {
    const urlObj = new URL(url, 'http://localhost');
    const days = Math.min(Math.max(Number(urlObj.searchParams.get('days')) || 30, 1), 365);
    const limit = Math.min(Math.max(Number(urlObj.searchParams.get('limit')) || 100, 1), 500);
    const actionFilter = urlObj.searchParams.get('action');
    const userIdFilter = urlObj.searchParams.get('userId');
    const overriddenFilter = urlObj.searchParams.get('overridden');

    if (userIdFilter && !isValidSnowflake(userIdFilter)) {
      throw ApiError.badRequest('userId must be a valid Discord snowflake');
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where: Record<string, unknown> = {
      guildId,
      createdAt: MoreThanOrEqual(since),
    };
    if (actionFilter) where.actionTaken = actionFilter;
    if (userIdFilter) where.userId = userIdFilter;
    if (overriddenFilter === 'true') where.overridden = true;
    else if (overriddenFilter === 'false') where.overridden = false;

    const rows = await logRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return { logs: rows, count: rows.length };
  });
}
