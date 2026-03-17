import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

const API_URL = process.env.API_URL;

export async function notifyGuildJoin(
  guildId: string,
  guildName: string,
  memberCount: number,
): Promise<void> {
  await sendWebhook('guild-join', {
    guildId,
    guildName,
    memberCount,
    joinedAt: new Date().toISOString(),
  });
}

export async function notifyGuildLeave(guildId: string): Promise<void> {
  await sendWebhook('guild-leave', { guildId });
}

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    // Block private/internal IPs
    const host = parsed.hostname;
    if (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host === '169.254.169.254' ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function sendWebhook(event: string, body: Record<string, unknown>): Promise<void> {
  if (!API_URL) return;

  const IS_DEV = (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';
  if (!IS_DEV && !isUrlSafe(API_URL)) {
    enhancedLogger.warn('API_URL blocked by URL safety check', LogCategory.API, { url: API_URL });
    return;
  }

  const token = process.env.COGWORKS_INTERNAL_API_TOKEN;
  if (!token) return;

  try {
    const response = await fetch(`${API_URL}/v2/cogworks/webhooks/${event}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      enhancedLogger.warn(`Guild webhook ${event} returned ${response.status}`, LogCategory.API, {
        event,
        status: response.status,
      });
    }
  } catch {
    enhancedLogger.warn(`Failed to send guild webhook: ${event}`, LogCategory.API, { event });
  }
}
