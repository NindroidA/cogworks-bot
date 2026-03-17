export interface UsernameAnalysisResult {
  isSuspicious: boolean;
  patterns: string[];
}

// Pre-compiled patterns (avoid Biome regex literal issues)
const DIGIT_SUFFIX_RE = /[a-z]{2,}\d{4,}$/i;
const HEX_STRING_RE = /^[0-9a-f]{8,}$/i;
const REPEATING_CHARS_RE = /(.)\1{4,}/;
const STRONG_REPEATING_RE = /(.)\1{6,}/;
const NO_VOWELS_RE = /^[bcdfghjklmnpqrstvwxyz0-9_]+$/i;

/**
 * Check if username ends with 4+ digits after a letter prefix.
 * Examples: "user12345", "john8392" — common bot naming patterns.
 */
export function hasDigitSuffix(username: string): boolean {
  return DIGIT_SUFFIX_RE.test(username);
}

/**
 * Check if username is entirely 8+ hex characters.
 * Examples: "a3f8b2c1d9e0" — random generated names.
 */
export function isHexString(username: string): boolean {
  return HEX_STRING_RE.test(username);
}

/**
 * Check if username has 5+ identical consecutive characters.
 * Examples: "aaaaaaa", "xxxxx" — low-effort bot names.
 */
export function hasRepeatingChars(username: string): boolean {
  return REPEATING_CHARS_RE.test(username);
}

/**
 * Check if a long username (8+ chars) contains no vowels.
 * Suggests random generation rather than a real name.
 * Short usernames are exempt — "brk" is a valid nickname.
 */
export function lacksVowels(username: string): boolean {
  if (username.length < 8) return false;
  return NO_VOWELS_RE.test(username);
}

/**
 * Analyze a username for bot-like patterns.
 *
 * Returns suspicious=true only when signals are strong enough:
 * - 2+ weak patterns match, OR
 * - hex string matches (strong signal alone), OR
 * - 7+ repeating chars (strong signal alone)
 *
 * Unicode usernames (CJK, Cyrillic, Arabic, etc.) are never flagged —
 * all patterns use ASCII character classes exclusively.
 */
export function analyzeUsername(username: string): UsernameAnalysisResult {
  if (!username || username.length === 0) {
    return { isSuspicious: false, patterns: [] };
  }

  const patterns: string[] = [];

  if (hasDigitSuffix(username)) patterns.push('digit suffix');
  if (isHexString(username)) patterns.push('hex string');
  if (hasRepeatingChars(username)) patterns.push('repeating chars');
  if (lacksVowels(username)) patterns.push('no vowels');

  // Determine if suspicious based on signal strength
  const isStrongHex = patterns.includes('hex string');
  const isStrongRepeat = STRONG_REPEATING_RE.test(username);
  const hasMultipleWeakSignals = patterns.length >= 2;

  const isSuspicious = isStrongHex || isStrongRepeat || hasMultipleWeakSignals;

  return { isSuspicious, patterns: isSuspicious ? patterns : [] };
}
