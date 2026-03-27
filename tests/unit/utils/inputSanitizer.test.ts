/**
 * Input Sanitizer Unit Tests
 *
 * Tests for Discord markdown escaping, snowflake validation, email masking,
 * URL validation, text truncation, zero-width stripping, mention sanitization,
 * text length validation, and the sanitizeUserInput pipeline.
 */

import { describe, expect, test } from "bun:test";
import {
  escapeDiscordMarkdown,
  maskEmail,
  sanitizeMentions,
  sanitizeUserInput,
  stripZeroWidthChars,
  truncateWithNotice,
  validateSafeUrl,
  validateTextLength,
} from "../../../src/utils/validation/inputSanitizer";
import { isValidSnowflake } from "../../../src/utils/api/helpers";

// ============================================================================
// escapeDiscordMarkdown
// ============================================================================

describe("escapeDiscordMarkdown", () => {
  test("should escape bold markers", () => {
    expect(escapeDiscordMarkdown("**bold**")).toBe("\\*\\*bold\\*\\*");
  });

  test("should escape italic underscores", () => {
    expect(escapeDiscordMarkdown("_italic_")).toBe("\\_italic\\_");
  });

  test("should escape inline code backticks", () => {
    expect(escapeDiscordMarkdown("`code`")).toBe("\\`code\\`");
  });

  test("should escape strikethrough tildes", () => {
    expect(escapeDiscordMarkdown("~~strike~~")).toBe("\\~\\~strike\\~\\~");
  });

  test("should escape spoiler pipes", () => {
    expect(escapeDiscordMarkdown("||spoiler||")).toBe("\\|\\|spoiler\\|\\|");
  });

  test("should escape blockquote markers", () => {
    expect(escapeDiscordMarkdown("> quote")).toBe("\\> quote");
  });

  test("should escape backslashes first", () => {
    expect(escapeDiscordMarkdown("\\*")).toBe("\\\\\\*");
  });

  test("should handle plain text without changes", () => {
    expect(escapeDiscordMarkdown("Hello world 123")).toBe("Hello world 123");
  });

  test("should handle empty string", () => {
    expect(escapeDiscordMarkdown("")).toBe("");
  });

  test("should handle combined markdown", () => {
    const input = "**bold** and _italic_ with `code`";
    const result = escapeDiscordMarkdown(input);
    expect(result).not.toContain("**");
    expect(result).not.toContain("_italic_");
    expect(result).not.toContain("`code`");
  });
});

// ============================================================================
// isValidSnowflake
// ============================================================================

describe("isValidSnowflake", () => {
  test("should accept valid 17-digit snowflake", () => {
    expect(isValidSnowflake("12345678901234567")).toBe(true);
  });

  test("should accept valid 18-digit snowflake", () => {
    expect(isValidSnowflake("123456789012345678")).toBe(true);
  });

  test("should accept valid 19-digit snowflake", () => {
    expect(isValidSnowflake("1234567890123456789")).toBe(true);
  });

  test("should accept valid 20-digit snowflake", () => {
    expect(isValidSnowflake("12345678901234567890")).toBe(true);
  });

  test("should reject 16-digit string (too short)", () => {
    expect(isValidSnowflake("1234567890123456")).toBe(false);
  });

  test("should reject 21-digit string (too long)", () => {
    expect(isValidSnowflake("123456789012345678901")).toBe(false);
  });

  test("should reject non-numeric string", () => {
    expect(isValidSnowflake("abcdefghijklmnopq")).toBe(false);
  });

  test("should reject mixed alphanumeric", () => {
    expect(isValidSnowflake("12345abc901234567")).toBe(false);
  });

  test("should reject empty string", () => {
    expect(isValidSnowflake("")).toBe(false);
  });

  test("should reject string with spaces", () => {
    expect(isValidSnowflake("12345 78901234567")).toBe(false);
  });
});

// ============================================================================
// maskEmail
// ============================================================================

describe("maskEmail", () => {
  test("should mask standard email", () => {
    expect(maskEmail("user@example.com")).toBe("u***@e***.com");
  });

  test("should mask single-char local part", () => {
    expect(maskEmail("a@example.com")).toBe("a***@e***.com");
  });

  test("should handle long local and domain", () => {
    expect(maskEmail("longuser@longdomain.org")).toBe("l***@l***.org");
  });

  test("should return *** for string without @", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });

  test("should return *** for @ at beginning", () => {
    expect(maskEmail("@example.com")).toBe("***");
  });

  test("should handle domain without dot", () => {
    expect(maskEmail("user@localhost")).toBe("u***@***");
  });

  test("should handle empty string", () => {
    expect(maskEmail("")).toBe("***");
  });

  test("should handle email with subdomain", () => {
    expect(maskEmail("user@mail.example.com")).toBe("u***@m***.com");
  });
});

// ============================================================================
// validateSafeUrl
// ============================================================================

describe("validateSafeUrl", () => {
  test("should accept valid HTTPS URL", () => {
    expect(validateSafeUrl("https://example.com")).toBeNull();
  });

  test("should accept HTTPS URL with path", () => {
    expect(validateSafeUrl("https://example.com/path/to/page")).toBeNull();
  });

  test("should reject HTTP URL", () => {
    expect(validateSafeUrl("http://example.com")).toBe(
      "Only HTTPS URLs are allowed",
    );
  });

  test("should reject invalid URL format", () => {
    expect(validateSafeUrl("not-a-url")).toBe("Invalid URL format");
  });

  test("should reject localhost", () => {
    expect(validateSafeUrl("https://localhost/admin")).toBe(
      "Internal hostnames are not allowed",
    );
  });

  test("should reject [::1]", () => {
    expect(validateSafeUrl("https://[::1]/admin")).toBe(
      "Internal hostnames are not allowed",
    );
  });

  test("should reject .local domains", () => {
    expect(validateSafeUrl("https://myserver.local/api")).toBe(
      "Internal hostnames are not allowed",
    );
  });

  test("should reject 10.x.x.x private IPs", () => {
    expect(validateSafeUrl("https://10.0.0.1")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });

  test("should reject 192.168.x.x private IPs", () => {
    expect(validateSafeUrl("https://192.168.1.1")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });

  test("should reject 172.16-31.x.x private IPs", () => {
    expect(validateSafeUrl("https://172.16.0.1")).toBe(
      "Private/internal IP addresses are not allowed",
    );
    expect(validateSafeUrl("https://172.31.255.255")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });

  test("should accept 172.15.x.x (not in private range)", () => {
    expect(validateSafeUrl("https://172.15.0.1")).toBeNull();
  });

  test("should reject 127.x.x.x loopback", () => {
    expect(validateSafeUrl("https://127.0.0.1")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });

  test("should reject 169.254.x.x link-local", () => {
    expect(validateSafeUrl("https://169.254.1.1")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });

  test("should reject 0.0.0.0", () => {
    expect(validateSafeUrl("https://0.0.0.0")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });

  test("should accept public IP", () => {
    expect(validateSafeUrl("https://8.8.8.8")).toBeNull();
  });

  test("should reject IPv6 loopback in brackets", () => {
    expect(validateSafeUrl("https://[::1]")).toBe(
      "Internal hostnames are not allowed",
    );
  });

  test("should reject IPv6 link-local fe80:", () => {
    expect(validateSafeUrl("https://[fe80::1]")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });

  test("should reject IPv6 unique-local fc/fd", () => {
    expect(validateSafeUrl("https://[fc00::1]")).toBe(
      "Private/internal IP addresses are not allowed",
    );
    expect(validateSafeUrl("https://[fd00::1]")).toBe(
      "Private/internal IP addresses are not allowed",
    );
  });
});

// ============================================================================
// truncateWithNotice
// ============================================================================

describe("truncateWithNotice", () => {
  test("should return original text if under limit", () => {
    expect(truncateWithNotice("short text", 100)).toBe("short text");
  });

  test("should return original text if exactly at limit", () => {
    const text = "x".repeat(50);
    expect(truncateWithNotice(text, 50)).toBe(text);
  });

  test("should truncate with notice when over limit", () => {
    const text = "a".repeat(200);
    const result = truncateWithNotice(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain("... (content truncated)");
  });

  test("should handle very small maxLength gracefully", () => {
    const text = "Hello world this is a test";
    const result = truncateWithNotice(text, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  test("should handle maxLength equal to suffix length", () => {
    const suffix = "\n\n... (content truncated)";
    const text = "a".repeat(100);
    const result = truncateWithNotice(text, suffix.length);
    expect(result.length).toBeLessThanOrEqual(suffix.length);
  });
});

// ============================================================================
// stripZeroWidthChars
// ============================================================================

describe("stripZeroWidthChars", () => {
  test("should remove zero-width space (U+200B)", () => {
    expect(stripZeroWidthChars("hello\u200Bworld")).toBe("helloworld");
  });

  test("should remove zero-width non-joiner (U+200C)", () => {
    expect(stripZeroWidthChars("hello\u200Cworld")).toBe("helloworld");
  });

  test("should remove zero-width joiner (U+200D)", () => {
    expect(stripZeroWidthChars("hello\u200Dworld")).toBe("helloworld");
  });

  test("should remove BOM / zero-width no-break space (U+FEFF)", () => {
    expect(stripZeroWidthChars("\uFEFFhello")).toBe("hello");
  });

  test("should remove soft hyphen (U+00AD)", () => {
    expect(stripZeroWidthChars("hello\u00ADworld")).toBe("helloworld");
  });

  test("should remove left-to-right mark (U+200E)", () => {
    expect(stripZeroWidthChars("hello\u200Eworld")).toBe("helloworld");
  });

  test("should remove right-to-left mark (U+200F)", () => {
    expect(stripZeroWidthChars("hello\u200Fworld")).toBe("helloworld");
  });

  test("should remove word joiner (U+2060)", () => {
    expect(stripZeroWidthChars("hello\u2060world")).toBe("helloworld");
  });

  test("should preserve normal text and regular whitespace", () => {
    expect(stripZeroWidthChars("Hello World 123!")).toBe("Hello World 123!");
  });

  test("should handle empty string", () => {
    expect(stripZeroWidthChars("")).toBe("");
  });

  test("should handle string that is entirely zero-width characters", () => {
    expect(stripZeroWidthChars("\u200B\u200C\u200D\uFEFF")).toBe("");
  });

  test("should remove multiple zero-width chars scattered in text", () => {
    expect(stripZeroWidthChars("\u200Bf\u200Cr\u200De\uFEFFe")).toBe("free");
  });
});

// ============================================================================
// sanitizeMentions
// ============================================================================

describe("sanitizeMentions", () => {
  test("should escape @everyone", () => {
    const result = sanitizeMentions("hello @everyone");
    expect(result).toBe("hello @\u200Beveryone");
    expect(result).not.toContain("@everyone");
  });

  test("should escape @here", () => {
    const result = sanitizeMentions("hello @here");
    expect(result).toBe("hello @\u200Bhere");
    expect(result).not.toContain("@here");
  });

  test("should escape @Everyone (case insensitive)", () => {
    const result = sanitizeMentions("hello @Everyone");
    expect(result).not.toBe("hello @Everyone");
    expect(result).toContain("@\u200B");
  });

  test("should escape @HERE (case insensitive)", () => {
    const result = sanitizeMentions("hello @HERE");
    expect(result).not.toBe("hello @HERE");
    expect(result).toContain("@\u200B");
  });

  test("should escape @EVERYONE (all caps)", () => {
    const result = sanitizeMentions("test @EVERYONE test");
    expect(result).toContain("@\u200B");
  });

  test("should preserve user mentions <@123456>", () => {
    expect(sanitizeMentions("<@123456789012345678>")).toBe(
      "<@123456789012345678>",
    );
  });

  test("should preserve role mentions <@&123456>", () => {
    expect(sanitizeMentions("<@&123456789012345678>")).toBe(
      "<@&123456789012345678>",
    );
  });

  test("should handle multiple @everyone and @here in one string", () => {
    const result = sanitizeMentions("@everyone and @here are dangerous");
    expect(result).not.toContain("@everyone");
    expect(result).not.toContain("@here");
  });

  test("should handle empty string", () => {
    expect(sanitizeMentions("")).toBe("");
  });

  test("should handle text with no mentions", () => {
    expect(sanitizeMentions("just normal text")).toBe("just normal text");
  });
});

// ============================================================================
// validateTextLength
// ============================================================================

describe("validateTextLength", () => {
  test("should return valid for text within limit", () => {
    const result = validateTextLength("hello", 100, "Title");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("should return valid for text at exact limit", () => {
    const text = "x".repeat(50);
    const result = validateTextLength(text, 50, "Title");
    expect(result.valid).toBe(true);
  });

  test("should return invalid for text exceeding limit", () => {
    const text = "x".repeat(101);
    const result = validateTextLength(text, 100, "Title");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Title");
    expect(result.error).toContain("100");
    expect(result.error).toContain("101");
  });

  test("should return invalid for empty string", () => {
    const result = validateTextLength("", 100, "Description");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Description");
    expect(result.error).toContain("empty");
  });

  test("should return invalid for whitespace-only string", () => {
    const result = validateTextLength("   \n\t  ", 100, "Content");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Content");
    expect(result.error).toContain("empty");
  });

  test("should include field name in error message", () => {
    const result = validateTextLength("x".repeat(200), 100, "Custom Field");
    expect(result.error).toContain("Custom Field");
  });
});

// ============================================================================
// sanitizeUserInput
// ============================================================================

describe("sanitizeUserInput", () => {
  test("should trim whitespace", () => {
    expect(sanitizeUserInput("  hello  ")).toBe("hello");
  });

  test("should strip zero-width characters by default", () => {
    expect(sanitizeUserInput("he\u200Bllo")).toBe("hello");
  });

  test("should sanitize mentions by default", () => {
    const result = sanitizeUserInput("@everyone says hi");
    expect(result).not.toBe("@everyone says hi");
    expect(result).toContain("@\u200B");
  });

  test("should NOT escape markdown by default", () => {
    expect(sanitizeUserInput("**bold**")).toBe("**bold**");
  });

  test("should escape markdown when option is enabled", () => {
    const result = sanitizeUserInput("**bold**", { escapeMarkdown: true });
    expect(result).toBe("\\*\\*bold\\*\\*");
  });

  test("should truncate when maxLength is provided", () => {
    const longText = "a".repeat(200);
    const result = sanitizeUserInput(longText, { maxLength: 50 });
    expect(result.length).toBeLessThanOrEqual(50);
  });

  test("should not truncate when text is within maxLength", () => {
    expect(sanitizeUserInput("short", { maxLength: 50 })).toBe("short");
  });

  test("should return empty string for null", () => {
    expect(sanitizeUserInput(null)).toBe("");
  });

  test("should return empty string for undefined", () => {
    expect(sanitizeUserInput(undefined)).toBe("");
  });

  test("should respect stripMentions: false option", () => {
    const result = sanitizeUserInput("@everyone", { stripMentions: false });
    expect(result).toBe("@everyone");
  });

  test("should respect stripZeroWidth: false option", () => {
    const result = sanitizeUserInput("he\u200Bllo", { stripZeroWidth: false });
    expect(result).toBe("he\u200Bllo");
  });

  test("should apply full pipeline: trim + zero-width + mentions", () => {
    const input = "  \u200BHello @everyone!  ";
    const result = sanitizeUserInput(input);
    expect(result).toBe("Hello @\u200Beveryone!");
  });

  test("should apply full pipeline with all options enabled", () => {
    const input = "  \u200B**bold** @everyone test  ";
    const result = sanitizeUserInput(input, {
      escapeMarkdown: true,
      maxLength: 100,
    });
    expect(result).toContain("\\*\\*bold\\*\\*");
    expect(result).not.toContain("@everyone");
  });

  test("should handle string that becomes empty after stripping zero-width", () => {
    expect(sanitizeUserInput("  \u200B\u200C\u200D  ")).toBe("");
  });
});
