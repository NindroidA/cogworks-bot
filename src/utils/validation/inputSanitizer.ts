/**
 * Input Sanitization Utilities
 *
 * Functions for validating and sanitizing user input across the bot.
 * Used to prevent Discord markdown injection and validate Discord IDs.
 */

// Pre-compiled regex patterns for performance
const ZERO_WIDTH_CHARS_RE =
  /[\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD\u034F\u061C\u180E\u2028\u2029\u202A-\u202F\u2066-\u2069]/g;
const MENTION_EVERYONE_RE = /@(everyone)/gi;
const MENTION_HERE_RE = /@(here)/gi;

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
 */
export function validateSafeUrl(url: string): {
  valid: boolean;
  error?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTPS URLs are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local')) {
    return { valid: false, error: 'Internal hostnames are not allowed' };
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
      return {
        valid: false,
        error: 'Private/internal IP addresses are not allowed',
      };
    }
  }

  // Block IPv6 link-local and loopback (bracket-wrapped in URLs)
  if (hostname.startsWith('[')) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    if (ipv6 === '::1' || ipv6.startsWith('fe80:') || ipv6.startsWith('fc') || ipv6.startsWith('fd')) {
      return {
        valid: false,
        error: 'Private/internal IP addresses are not allowed',
      };
    }
  }

  return { valid: true };
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

/**
 * Removes zero-width and invisible Unicode characters from a string.
 * These can be used to bypass keyword detection or confuse display.
 */
export function stripZeroWidthChars(input: string): string {
  return input.replace(ZERO_WIDTH_CHARS_RE, '');
}

/**
 * Escapes `@everyone` and `@here` mentions in user content to prevent mass pings.
 * Inserts a zero-width space after `@` to break the mention.
 * Does NOT escape user/role mentions (`<@123>`, `<@&123>`) — those are controlled by `allowedMentions`.
 */
export function sanitizeMentions(input: string): string {
  return input.replace(MENTION_EVERYONE_RE, '@\u200B$1').replace(MENTION_HERE_RE, '@\u200B$1');
}

/**
 * Validates that a text input meets length requirements.
 * Returns a structured result with field name in error messages.
 */
export function validateTextLength(
  input: string,
  maxLength: number,
  fieldName: string,
): { valid: boolean; error?: string } {
  if (!input || input.trim().length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty.` };
  }
  if (input.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} exceeds the maximum length of ${maxLength} characters (currently ${input.length}).`,
    };
  }
  return { valid: true };
}

/**
 * Options for the `sanitizeUserInput` convenience pipeline.
 */
export interface SanitizeOptions {
  /** Escape Discord markdown characters. Default: false */
  escapeMarkdown?: boolean;
  /** Truncate to this length (with notice). Default: undefined (no truncation) */
  maxLength?: number;
  /** Strip @everyone and @here mentions. Default: true */
  stripMentions?: boolean;
  /** Remove zero-width/invisible characters. Default: true */
  stripZeroWidth?: boolean;
}

/**
 * Convenience pipeline that applies standard sanitization to user input:
 * 1. trim()
 * 2. stripZeroWidthChars() (unless disabled)
 * 3. sanitizeMentions() (unless disabled)
 * 4. escapeDiscordMarkdown() (if enabled)
 * 5. truncateWithNotice() (if maxLength provided)
 */
export function sanitizeUserInput(input: string | null | undefined, options?: SanitizeOptions): string {
  if (input == null) return '';

  let result = input.trim();

  if (options?.stripZeroWidth !== false) {
    result = stripZeroWidthChars(result);
  }

  if (options?.stripMentions !== false) {
    result = sanitizeMentions(result);
  }

  if (options?.escapeMarkdown) {
    result = escapeDiscordMarkdown(result);
  }

  if (options?.maxLength != null) {
    result = truncateWithNotice(result, options.maxLength);
  }

  return result;
}
