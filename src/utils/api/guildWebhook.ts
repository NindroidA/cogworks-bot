import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { validateSafeUrl } from '../validation/inputSanitizer';

const API_URL = process.env.API_URL;

export async function notifyGuildJoin(guildId: string, guildName: string, memberCount: number): Promise<void> {
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

async function sendWebhook(event: string, body: Record<string, unknown>): Promise<void> {
  if (!API_URL) return;

  const IS_DEV = (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';
  if (!IS_DEV && !validateSafeUrl(API_URL).valid) {
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
