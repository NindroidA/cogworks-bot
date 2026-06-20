export type { Language, Locale } from '../lang';
/** Re-export lang module with type safety */
export {
  DEFAULT_LOCALE,
  getGuildLang,
  getGuildLocale,
  getLangForLocale,
  invalidateGuildLocaleCache,
  isSupportedLocale,
  lang,
  SUPPORTED_LOCALES,
} from '../lang';

// Note: internalApiServer is NOT re-exported here to avoid a 20-file import cycle.
// Import directly: import { internalApiServer } from './utils/api/internalApiServer';
// Core utilities
export * from './apiConnector';
export * from './baitChannel/baitChannelManager';
export * from './collectors';
export * from './colors';
// Constants
export * from './constants';
// Database utilities
export * from './database/ensureDefaultTicketTypes';
export * from './database/guildQueries';
export * from './database/legacyMigration';
// Discord verified deletion utilities
export * from './discord/verifiedDelete';
export * from './embedBuilders';
export * from './emojis';
export * from './errorHandler';
// Forum utilities
export * from './forumTagManager';
// Interaction helpers (guard, confirm, modal)
export * from './interactions';
// Modal component helpers (raw API objects for new Discord components)
export * from './modalComponents';
// Monitoring utilities
export * from './monitoring/enhancedLogger';
export * from './monitoring/errorReporter';
export * from './monitoring/healthMonitor';
export * from './monitoring/healthServer';
export * from './monitoring/memoryWatchdog';
// Reaction role utilities
export * from './reactionRole';
// Security utilities
export * from './security/rateLimiter';
// Setup utilities
export * from './setup';
// Status utilities
export * from './status';
export * from './types';
// Validation utilities
export * from './validation/inputSanitizer';
export * from './validation/permissionValidator';
export * from './validation/validators';

/**
 * Format a byte count into a human-readable string (B, KB, MB, GB).
 * Starts from the lowest unit and scales up as needed.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Formats a language template string with arguments
 * @param template - Template string with {0}, {1}, etc. placeholders
 * @param args - Arguments to replace placeholders with
 * @returns Formatted string
 * @example
 * formatLang("Hello {0}, you have {1} messages", "John", 5)
 * // Returns: "Hello John, you have 5 messages"
 */
export function formatLang(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const argIndex = parseInt(index, 10);
    return args[argIndex] !== undefined ? String(args[argIndex]) : match;
  });
}

/**
 * Extracts Discord ID from a mention string
 * @param mention - Discord mention string (e.g., "<@123456789>" or "<@&123456789>")
 * @returns Extracted ID or null if invalid format
 * @example
 * extractIdFromMention("<@123456789>") // Returns: "123456789"
 * extractIdFromMention("<@&987654321>") // Returns: "987654321"
 */
export function extractIdFromMention(mention: string): string | null {
  const matches = mention.match(/^<@&?(\d+)>$/);
  return matches ? matches[1] : null;
}

/**
 * Returns the offset (ms) of `timeZone` from UTC at the given instant, DST-aware.
 * Positive when the zone is ahead of UTC. Uses Intl (available under Bun/Node)
 * so no timezone database dependency is needed.
 */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  // What wall-clock `instant` shows as in the zone, read back as if it were UTC.
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asIfUtc - instant.getTime();
}

/**
 * Parses a time input string into a Date, interpreting the wall-clock value in
 * the given IANA `timeZone` (DST-aware). Defaults to UTC for backward
 * compatibility. Callers should render the resulting Unix timestamp as a
 * Discord timestamp (`<t:UNIX:F>`) so each viewer sees their own local time.
 *
 * @param timeInput - Time string in format "YYYY-MM-DD HH:MM AM/PM"
 * @param timeZone - IANA zone (e.g. "America/Chicago") the input is expressed in; default "UTC"
 * @returns Parsed Date (the correct UTC instant) or null if invalid
 * @example
 * parseTimeInput("2025-10-27 3:45 PM", "America/Chicago")
 * // Returns the UTC instant for 3:45 PM Central on that date (CDT/CST handled)
 */
export function parseTimeInput(timeInput: string, timeZone = 'UTC'): Date | null {
  try {
    // Parse YYYY-MM-DD HH:MM AM/PM format
    const match = timeInput.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
    if (!match) return null;

    const [, year, month, day, hourStr, minute, ampm] = match;

    // Convert to 24-hour format
    let hour = parseInt(hourStr, 10);
    if (ampm.toUpperCase() === 'PM' && hour !== 12) {
      hour += 12;
    } else if (ampm.toUpperCase() === 'AM' && hour === 12) {
      hour = 0;
    }

    if (timeZone === 'UTC') {
      const hourFormatted = hour.toString().padStart(2, '0');
      const utcTime = new Date(`${year}-${month}-${day}T${hourFormatted}:${minute}:00Z`);
      return Number.isNaN(utcTime.getTime()) ? null : utcTime;
    }

    // Interpret the wall-clock components as local time in `timeZone`, then
    // correct to the true UTC instant using that zone's offset at that time.
    const asUtcGuess = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute), 0));
    if (Number.isNaN(asUtcGuess.getTime())) return null;
    const offset = tzOffsetMs(asUtcGuess, timeZone);
    return new Date(asUtcGuess.getTime() - offset);
  } catch {
    return null;
  }
}
