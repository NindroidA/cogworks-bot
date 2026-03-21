/**
 * Template Engine Unit Tests
 *
 * Tests placeholder replacement, detection, and metadata retrieval
 * for the announcement template engine.
 */

import { describe, expect, test } from "bun:test";
import {
  detectDynamicPlaceholders,
  getAvailablePlaceholders,
  renderTemplate,
  type TemplatePlaceholderParams,
} from "../../../../src/utils/announcement/templateEngine";
import type { AnnouncementTemplate } from "../../../../src/typeorm/entities/announcement/AnnouncementTemplate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTemplate(
  overrides: Partial<AnnouncementTemplate> = {},
): AnnouncementTemplate {
  return {
    id: 1,
    guildId: "123",
    name: "test-template",
    displayName: "Test Template",
    description: null,
    title: "Test Title",
    body: "Test body",
    color: "#5865F2",
    fields: [],
    footerText: null,
    showTimestamp: false,
    mentionRole: false,
    isDefault: false,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AnnouncementTemplate;
}

// ===========================================================================
// getAvailablePlaceholders
// ===========================================================================
describe("getAvailablePlaceholders()", () => {
  test("should return an array of placeholder metadata", () => {
    const placeholders = getAvailablePlaceholders();
    expect(Array.isArray(placeholders)).toBe(true);
    expect(placeholders.length).toBeGreaterThan(0);
  });

  test("each placeholder should have name, description, example, requiresInput", () => {
    const placeholders = getAvailablePlaceholders();
    for (const p of placeholders) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.description).toBe("string");
      expect(typeof p.example).toBe("string");
      expect(typeof p.requiresInput).toBe("boolean");
    }
  });

  test('should include "version" placeholder', () => {
    const placeholders = getAvailablePlaceholders();
    const version = placeholders.find((p) => p.name === "version");
    expect(version).toBeDefined();
    expect(version!.requiresInput).toBe(true);
  });

  test('should include "server" placeholder that does not require input', () => {
    const placeholders = getAvailablePlaceholders();
    const server = placeholders.find((p) => p.name === "server");
    expect(server).toBeDefined();
    expect(server!.requiresInput).toBe(false);
  });
});

// ===========================================================================
// detectDynamicPlaceholders
// ===========================================================================
describe("detectDynamicPlaceholders()", () => {
  test("should detect {version} in title", () => {
    const template = createTemplate({ title: "Release {version}" });
    const dynamic = detectDynamicPlaceholders(template);
    expect(dynamic.some((p) => p.name === "version")).toBe(true);
  });

  test("should detect {duration} in body", () => {
    const template = createTemplate({ body: "Downtime: {duration}" });
    const dynamic = detectDynamicPlaceholders(template);
    expect(dynamic.some((p) => p.name === "duration")).toBe(true);
  });

  test("should detect placeholders in fields", () => {
    const template = createTemplate({
      fields: [{ name: "When", value: "{time}", inline: false }],
    });
    const dynamic = detectDynamicPlaceholders(template);
    expect(dynamic.some((p) => p.name === "time")).toBe(true);
  });

  test("should return empty array when no dynamic placeholders", () => {
    const template = createTemplate({
      title: "Hello",
      body: "No placeholders here",
    });
    const dynamic = detectDynamicPlaceholders(template);
    expect(dynamic.length).toBe(0);
  });

  test("should NOT include non-input placeholders like {server}", () => {
    const template = createTemplate({ title: "Welcome to {server}" });
    const dynamic = detectDynamicPlaceholders(template);
    // {server} has requiresInput: false so should not be detected
    expect(dynamic.some((p) => p.name === "server")).toBe(false);
  });
});

// ===========================================================================
// renderTemplate — placeholder replacement
// ===========================================================================
describe("renderTemplate()", () => {
  test("should replace {version} with provided value", () => {
    const template = createTemplate({
      title: "Release {version}",
      body: "Version {version} is out!",
    });
    const params: TemplatePlaceholderParams = { version: "2.0.0" };
    const result = renderTemplate(template, params, null, null);

    const embed = result.embeds[0].toJSON();
    expect(embed.title).toBe("Release 2.0.0");
    expect(embed.description).toBe("Version 2.0.0 is out!");
  });

  test("unknown placeholders should pass through unchanged", () => {
    const template = createTemplate({ body: "Hello {unknown} world" });
    const result = renderTemplate(template, {}, null, null);

    const embed = result.embeds[0].toJSON();
    expect(embed.description).toBe("Hello {unknown} world");
  });

  test("should replace multiple different placeholders in one string", () => {
    const template = createTemplate({
      body: "Upgrading to {version}, downtime {duration}",
    });
    const params: TemplatePlaceholderParams = {
      version: "3.0",
      duration: "10 minutes",
    };
    const result = renderTemplate(template, params, null, null);

    const embed = result.embeds[0].toJSON();
    expect(embed.description).toContain("3.0");
    expect(embed.description).toContain("10 minutes");
  });

  test("should handle empty params without errors", () => {
    const template = createTemplate({ title: "No params", body: "Just text" });
    const result = renderTemplate(template, {}, null, null);

    const embed = result.embeds[0].toJSON();
    expect(embed.title).toBe("No params");
    expect(embed.description).toBe("Just text");
  });

  test("should set embed color from template hex", () => {
    const template = createTemplate({ color: "#FF0000" });
    const result = renderTemplate(template, {}, null, null);

    const embed = result.embeds[0].toJSON();
    expect(embed.color).toBe(0xff0000);
  });

  test("should render fields with placeholder replacement", () => {
    const template = createTemplate({
      body: "body",
      fields: [{ name: "Version", value: "{version}", inline: true }],
    });
    const result = renderTemplate(template, { version: "1.5" }, null, null);

    const embed = result.embeds[0].toJSON();
    expect(embed.fields).toBeDefined();
    expect(embed.fields![0].value).toBe("1.5");
    expect(embed.fields![0].inline).toBe(true);
  });

  test("should set content to role mention when mentionRole is true", () => {
    const template = createTemplate({ mentionRole: true });
    const result = renderTemplate(template, {}, null, null, "role-123");

    expect(result.content).toBe("<@&role-123>");
  });

  test("should not set content when mentionRole is false", () => {
    const template = createTemplate({ mentionRole: false });
    const result = renderTemplate(template, {}, null, null, "role-123");

    expect(result.content).toBeUndefined();
  });

  test("HTML/XSS in param values should pass through (Discord renders safely)", () => {
    const template = createTemplate({ body: "Info: {version}" });
    const result = renderTemplate(
      template,
      { version: '<script>alert("xss")</script>' },
      null,
      null,
    );

    const embed = result.embeds[0].toJSON();
    // sanitizeUserInput may strip some chars, but should not crash
    expect(embed.description).toBeDefined();
  });

  test("should replace {time} with Discord timestamp format", () => {
    const template = createTemplate({ body: "Starting at {time}" });
    const ts = 1700000000;
    const result = renderTemplate(template, { time: ts }, null, null);

    const embed = result.embeds[0].toJSON();
    expect(embed.description).toBe(`Starting at <t:${ts}:F>`);
  });
});
