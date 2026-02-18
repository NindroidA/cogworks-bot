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
 * Truncates text to maxLength with an indicator that content was cut.
 * Useful for modal pre-fill and embed descriptions.
 */
export function truncateWithNotice(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const suffix = '\n\n... (content truncated)';
  if (maxLength <= suffix.length) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - suffix.length)}${suffix}`;
}
