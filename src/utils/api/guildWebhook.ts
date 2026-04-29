import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { validateSafeUrl } from '../validation/inputSanitizer';

// Read env at first call rather than module-load time. Mirrors the v3.1.7
// `getRest()` deferral so importing this file does not snapshot env vars
// before tests / tooling have a chance to set them.
function getApiUrl(): string | undefined {
  return process.env.API_URL;
}

function isDev(): boolean {
  return (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';
}

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
  const apiUrl = getApiUrl();
  if (!apiUrl) return;

  if (!isDev() && !validateSafeUrl(apiUrl).valid) {
    enhancedLogger.warn('API_URL blocked by URL safety check', LogCategory.API, { url: apiUrl });
    return;
  }

  const token = process.env.COGWORKS_INTERNAL_API_TOKEN;
  if (!token) return;

  try {
    const response = await fetch(`${apiUrl}/v2/cogworks/webhooks/${event}`, {
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
