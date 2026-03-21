import { lang } from '../../lang';
import { AppDataSource } from '../../typeorm';
import { BotStatus } from '../../typeorm/entities/status';

const tl = lang.status;

/** Cached status to avoid DB queries on every command */
let cachedLevel: string | null = null;
let cachedMessage: string | null = null;
let cacheExpiry = 0;

/** Cache TTL: 30 seconds */
const BANNER_CACHE_TTL = 30_000;

/**
 * Returns a warning banner string if the bot is in a degraded or outage state.
 * Returns null if the bot is operational or in maintenance.
 *
 * Designed to be called at the top of command handlers to prepend status warnings.
 * Uses a short-lived cache to avoid hitting the database on every command.
 */
export async function getStatusBanner(): Promise<string | null> {
  const now = Date.now();

  if (now < cacheExpiry && cachedLevel !== null) {
    return buildBanner(cachedLevel, cachedMessage);
  }

  try {
    const statusRepo = AppDataSource.getRepository(BotStatus);
    const status = await statusRepo.findOneBy({ id: 1 });

    if (!status) {
      cachedLevel = 'operational';
      cachedMessage = null;
      cacheExpiry = now + BANNER_CACHE_TTL;
      return null;
    }

    cachedLevel = status.level;
    cachedMessage = status.message;
    cacheExpiry = now + BANNER_CACHE_TTL;

    return buildBanner(status.level, status.message);
  } catch {
    // On error, don't block the command — return null
    return null;
  }
}

function buildBanner(level: string, message: string | null): string | null {
  if (level === 'operational' || level === 'maintenance') {
    return null;
  }

  const levelLabel = tl.levels[level as keyof typeof tl.levels] || level;
  let banner = tl.banner.warning.replace('{level}', levelLabel);

  if (message) {
    banner += `\n> ${message}`;
  }

  return banner;
}

/**
 * Invalidate the banner cache (call after status changes).
 */
export function invalidateStatusBannerCache(): void {
  cacheExpiry = 0;
  cachedLevel = null;
  cachedMessage = null;
}
