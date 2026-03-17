import type { Client } from 'discord.js';
import { DEFAULT_KEYWORDS } from '../../../commands/handlers/baitChannel/keywords';
import { AppDataSource } from '../../../typeorm';
import { BaitKeyword } from '../../../typeorm/entities/bait/BaitKeyword';
import type { BaitChannelManager } from '../../baitChannelManager';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

type ClientWithBaitManager = Client & {
  baitChannelManager?: BaitChannelManager;
};

const MAX_KEYWORDS = 50;

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
      return { error: 'keyword must be 1-100 characters' };
    }
    if (weight < 1 || weight > 10) {
      return { error: 'weight must be between 1 and 10' };
    }

    const count = await keywordRepo.count({ where: { guildId } });
    if (count >= MAX_KEYWORDS) {
      return { error: 'Maximum 50 keywords reached' };
    }

    const existing = await keywordRepo.findOne({ where: { guildId, keyword } });
    if (existing) {
      return { error: `Keyword '${keyword}' already exists` };
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
      return { error: 'keyword is required' };
    }

    const result = await keywordRepo.delete({ guildId, keyword });
    if (!result.affected) {
      return { error: 'Keyword not found' };
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
}
