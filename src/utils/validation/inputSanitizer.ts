/**
 * Input Sanitization Utilities
 *
 * Functions for validating and sanitizing user input across the bot.
 * Used to prevent Discord markdown injection and validate Discord IDs.
 */

/**
 * Escapes Discord markdown special characters.
 * Use when user input is placed within a markdown context
 * where it could break formatting (e.g., inside bold headers).
 *
 * Do NOT use when user content is displayed in its own block
 * (e.g., memory descriptions) — users want their markdown preserved there.
 */
export function escapeDiscordMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/~/g, '\\~')
    .replace(/\|/g, '\\|')
    .replace(/>/g, '\\>');
}

/**
 * Validates a Discord snowflake ID (17-20 digit numeric string).
 */
export function validateSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

/**
 * Masks an email address for safe logging.
 * `user@example.com` → `u***@e***.com`
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex < 1) return '***';
  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);
  const dotIndex = domain.lastIndexOf('.');
  if (dotIndex < 1) return `${local[0]}***@***`;
  const domainName = domain.substring(0, dotIndex);
  const tld = domain.substring(dotIndex);
  return `${local[0]}***@${domainName[0]}***${tld}`;
}

/**
 * Validates a URL is safe (HTTPS only, no internal/private IPs).
 * Returns null if safe, or an error reason string if blocked.
 */
export function validateSafeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL format';
  }

  if (parsed.protocol !== 'https:') {
    return 'Only HTTPS URLs are allowed';
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local')) {
    return 'Internal hostnames are not allowed';
  }

  // Block private/internal IP ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 127 || // 127.0.0.0/8
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) || // 169.254.0.0/16 (link-local + cloud metadata)
      a === 0 // 0.0.0.0/8
    ) {
      return 'Private/internal IP addresses are not allowed';
    }
  }

  // Block IPv6 link-local and loopback (bracket-wrapped in URLs)
  if (hostname.startsWith('[')) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    if (
      ipv6 === '::1' ||
      ipv6.startsWith('fe80:') ||
      ipv6.startsWith('fc') ||
      ipv6.startsWith('fd')
    ) {
      return 'Private/internal IP addresses are not allowed';
    }
  }

  return null;
}

/**
 * Truncates text to maxLength with an indicator that content was cut.
 * Useful for modal pre-fill and embed descriptions.
 */
export function truncateWithNotice(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const suffix = '\n\n... (content truncated)';
  if (maxLength <= suffix.length) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - suffix.length)}${suffix}`;
}
