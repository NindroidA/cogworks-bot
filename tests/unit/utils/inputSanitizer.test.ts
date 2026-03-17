/**
 * Input Sanitizer Unit Tests
 *
 * Tests for Discord markdown escaping, snowflake validation,
 * and text truncation utilities.
 */

import { describe, expect, test } from '@jest/globals';
import {
  escapeDiscordMarkdown,
  validateSnowflake,
  truncateWithNotice,
} from '../../../src/utils/validation/inputSanitizer';

describe('escapeDiscordMarkdown', () => {
  test('should escape bold markers', () => {
    expect(escapeDiscordMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*');
  });

  test('should escape italic underscores', () => {
    expect(escapeDiscordMarkdown('_italic_')).toBe('\\_italic\\_');
  });

  test('should escape inline code backticks', () => {
    expect(escapeDiscordMarkdown('`code`')).toBe('\\`code\\`');
  });

  test('should escape strikethrough tildes', () => {
    expect(escapeDiscordMarkdown('~~strike~~')).toBe('\\~\\~strike\\~\\~');
  });

  test('should escape spoiler pipes', () => {
    expect(escapeDiscordMarkdown('||spoiler||')).toBe('\\|\\|spoiler\\|\\|');
  });

  test('should escape blockquote markers', () => {
    expect(escapeDiscordMarkdown('> quote')).toBe('\\> quote');
  });

  test('should escape backslashes first', () => {
    expect(escapeDiscordMarkdown('\\*')).toBe('\\\\\\*');
  });

  test('should handle plain text without changes', () => {
    expect(escapeDiscordMarkdown('Hello world 123')).toBe('Hello world 123');
  });

  test('should handle empty string', () => {
    expect(escapeDiscordMarkdown('')).toBe('');
  });

  test('should handle combined markdown', () => {
    const input = '**bold** and _italic_ with `code`';
    const result = escapeDiscordMarkdown(input);
    expect(result).not.toContain('**');
    expect(result).not.toContain('_italic_');
    expect(result).not.toContain('`code`');
  });
});

describe('validateSnowflake', () => {
  test('should accept valid 17-digit snowflake', () => {
    expect(validateSnowflake('12345678901234567')).toBe(true);
  });

  test('should accept valid 18-digit snowflake', () => {
    expect(validateSnowflake('123456789012345678')).toBe(true);
  });

  test('should accept valid 19-digit snowflake', () => {
    expect(validateSnowflake('1234567890123456789')).toBe(true);
  });

  test('should accept valid 20-digit snowflake', () => {
    expect(validateSnowflake('12345678901234567890')).toBe(true);
  });

  test('should reject 16-digit string (too short)', () => {
    expect(validateSnowflake('1234567890123456')).toBe(false);
  });

  test('should reject 21-digit string (too long)', () => {
    expect(validateSnowflake('123456789012345678901')).toBe(false);
  });

  test('should reject non-numeric string', () => {
    expect(validateSnowflake('abcdefghijklmnopq')).toBe(false);
  });

  test('should reject mixed alphanumeric', () => {
    expect(validateSnowflake('12345abc901234567')).toBe(false);
  });

  test('should reject empty string', () => {
    expect(validateSnowflake('')).toBe(false);
  });

  test('should reject string with spaces', () => {
    expect(validateSnowflake('12345 78901234567')).toBe(false);
  });
});

describe('truncateWithNotice', () => {
  test('should return original text if under limit', () => {
    expect(truncateWithNotice('short text', 100)).toBe('short text');
  });

  test('should return original text if exactly at limit', () => {
    const text = 'x'.repeat(50);
    expect(truncateWithNotice(text, 50)).toBe(text);
  });

  test('should truncate with notice when over limit', () => {
    const text = 'a'.repeat(200);
    const result = truncateWithNotice(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain('... (content truncated)');
  });

  test('should handle very small maxLength gracefully', () => {
    const text = 'Hello world this is a test';
    const result = truncateWithNotice(text, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  test('should handle maxLength equal to suffix length', () => {
    const suffix = '\n\n... (content truncated)';
    const text = 'a'.repeat(100);
    const result = truncateWithNotice(text, suffix.length);
    expect(result.length).toBeLessThanOrEqual(suffix.length);
  });
});
