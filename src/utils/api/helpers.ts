const SNOWFLAKE_RE = /^\d{17,20}$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Extracts a numeric ID from a URL path segment.
 * e.g., extractId('/tickets/123/close', 'tickets') → 123
 */
export function extractId(url: string, segment: string): number {
  const match = url.match(new RegExp(`${segment}/(\\d+)`));
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** Validates a Discord snowflake ID (17-20 digit numeric string). */
export function isValidSnowflake(id: string): boolean {
  return SNOWFLAKE_RE.test(id);
}

/** Validates a hex color string (#RRGGBB). Returns null if valid, error string if not. */
export function validateHexColor(color: string): string | null {
  return HEX_COLOR_RE.test(color) ? null : 'Invalid color format, expected #RRGGBB';
}
