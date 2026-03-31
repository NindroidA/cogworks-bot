import { ApiError } from './apiError';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Extracts a numeric ID from a URL path segment.
 * e.g., extractId('/tickets/123/close', 'tickets') → 123
 * Returns null if the segment/ID pattern is not found.
 */
export function extractId(url: string, segment: string): number | null {
  const match = url.match(new RegExp(`${segment}/(\\d+)`));
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Extracts a numeric ID from a URL path segment, throwing 400 Bad Request if missing.
 * Use this in route handlers where the ID is required.
 */
export function requireId(url: string, segment: string): number {
  const id = extractId(url, segment);
  if (id === null) throw ApiError.badRequest(`Missing or invalid ${segment} ID in URL`);
  return id;
}

/** Validates a Discord snowflake ID (17-20 digit numeric string). */
export function isValidSnowflake(id: string): boolean {
  return SNOWFLAKE_RE.test(id);
}

/** Validates a hex color string (#RRGGBB). */
export function validateHexColor(color: string): {
  valid: boolean;
  error?: string;
} {
  return HEX_COLOR_RE.test(color) ? { valid: true } : { valid: false, error: 'Invalid color format, expected #RRGGBB' };
}

// ---------------------------------------------------------------------------
// Request body field extraction — runtime-safe replacements for `as` casts
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

/** Extract a required string field. Throws 400 if missing or not a string. */
export function requireString(body: Body, field: string): string {
  const v = body[field];
  if (typeof v !== 'string' || !v.trim()) throw ApiError.badRequest(`${field} is required`);
  return v.trim();
}

/** Extract an optional string field. Returns undefined if absent/null. Throws 400 if wrong type. */
export function optionalString(body: Body, field: string): string | undefined {
  const v = body[field];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw ApiError.badRequest(`${field} must be a string`);
  return v.trim() || undefined;
}

/** Extract a required number field. Throws 400 if missing or not a number. */
export function requireNumber(body: Body, field: string): number {
  const v = body[field];
  if (typeof v !== 'number' || Number.isNaN(v)) throw ApiError.badRequest(`${field} is required and must be a number`);
  return v;
}

/** Extract an optional number field. Returns undefined if absent/null. */
export function optionalNumber(body: Body, field: string): number | undefined {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || Number.isNaN(v)) throw ApiError.badRequest(`${field} must be a number`);
  return v;
}

/** Extract a required boolean field. Throws 400 if missing or not a boolean. */
export function requireBoolean(body: Body, field: string): boolean {
  const v = body[field];
  if (typeof v !== 'boolean') throw ApiError.badRequest(`${field} is required and must be a boolean`);
  return v;
}

/** Extract an optional string array field. Returns undefined if absent/null. */
export function optionalStringArray(body: Body, field: string): string[] | undefined {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every(i => typeof i === 'string')) {
    throw ApiError.badRequest(`${field} must be an array of strings`);
  }
  return v as string[];
}
