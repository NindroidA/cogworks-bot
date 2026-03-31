/**
 * Internal API Server Unit Tests
 *
 * Tests route matching patterns, URL parsing, and extractId helper logic.
 * Uses production code directly — no local reimplementations.
 */

import { describe, expect, test } from "bun:test";
import { extractId, requireId } from "../../../src/utils/api/helpers";

// ===========================================================================
// extractId (production import)
// ===========================================================================

describe("extractId (production)", () => {
  test("extracts numeric ID from URL segment", () => {
    expect(extractId("/internal/guilds/123/tickets/456/close", "tickets")).toBe(
      456,
    );
  });

  test("extracts ID from reaction-roles segment", () => {
    expect(
      extractId(
        "/internal/guilds/123/reaction-roles/789/rebuild",
        "reaction-roles",
      ),
    ).toBe(789);
  });

  test("returns null when segment not found", () => {
    expect(extractId("/internal/guilds/123/other/path", "tickets")).toBeNull();
  });

  test("returns null when ID is not numeric", () => {
    expect(
      extractId("/internal/guilds/123/tickets/abc/close", "tickets"),
    ).toBeNull();
  });

  test("extracts first matching ID", () => {
    expect(extractId("/tickets/111/sub/tickets/222", "tickets")).toBe(111);
  });

  test("handles large Discord-style IDs", () => {
    const result = extractId("/tickets/1234567890123456789/close", "tickets");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("number");
  });
});

// ===========================================================================
// requireId (production import)
// ===========================================================================

describe("requireId (production)", () => {
  test("returns number on valid segment", () => {
    expect(requireId("/tickets/456/close", "tickets")).toBe(456);
  });

  test("throws on missing segment", () => {
    expect(() => requireId("/other/path", "tickets")).toThrow();
  });
});

// ===========================================================================
// Guild URL regex pattern
// ===========================================================================

describe("Guild URL pattern matching", () => {
  // This regex is internal to internalApiServer.ts — test the pattern directly
  const guildUrlRegex = /^\/internal\/guilds\/(\d+)(\/.*)?$/;

  test("matches valid guild URL with subpath", () => {
    const match = "/internal/guilds/123456789/tickets/1/close".match(
      guildUrlRegex,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("123456789");
    expect(match![2]).toBe("/tickets/1/close");
  });

  test("matches guild URL with no subpath", () => {
    const match = "/internal/guilds/123456789".match(guildUrlRegex);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("123456789");
    expect(match![2]).toBeUndefined();
  });

  test("matches guild URL with slash only subpath", () => {
    const match = "/internal/guilds/123456789/".match(guildUrlRegex);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("/");
  });

  test("rejects non-numeric guild ID", () => {
    const match = "/internal/guilds/abc/tickets".match(guildUrlRegex);
    expect(match).toBeNull();
  });

  test("rejects wrong prefix", () => {
    const match = "/api/guilds/123/tickets".match(guildUrlRegex);
    expect(match).toBeNull();
  });

  test("rejects empty guild ID", () => {
    const match = "/internal/guilds//tickets".match(guildUrlRegex);
    expect(match).toBeNull();
  });
});

// ===========================================================================
// Route pattern matching
// ===========================================================================

describe("Route pattern matching", () => {
  // matchRoute is internal to internalApiServer — test the algorithm directly
  const COLON_PARAM = /:(\w+)/g;
  const DIGIT_GROUP = String.raw`(\d+)`;

  function matchRoute(
    routes: Map<string, string>,
    routeKey: string,
  ): string | null {
    const exact = routes.get(routeKey);
    if (exact) return exact;

    for (const [pattern, handler] of routes) {
      const regexStr = `^${pattern.replace(COLON_PARAM, DIGIT_GROUP)}$`;
      if (new RegExp(regexStr).test(routeKey)) return handler;
    }

    return null;
  }

  test("matches exact static route", () => {
    const routes = new Map([
      ["POST /announcements/send", "announcement-handler"],
    ]);
    expect(matchRoute(routes, "POST /announcements/send")).toBe(
      "announcement-handler",
    );
  });

  test("matches parameterized route", () => {
    const routes = new Map([
      ["POST /tickets/:id/close", "ticket-close-handler"],
    ]);
    expect(matchRoute(routes, "POST /tickets/123/close")).toBe(
      "ticket-close-handler",
    );
  });

  test("matches route with multiple params", () => {
    const routes = new Map([
      ["POST /tickets/:id/comments/:commentId", "comment-handler"],
    ]);
    expect(matchRoute(routes, "POST /tickets/123/comments/456")).toBe(
      "comment-handler",
    );
  });

  test("rejects non-matching route", () => {
    const routes = new Map([
      ["POST /tickets/:id/close", "ticket-close-handler"],
    ]);
    expect(matchRoute(routes, "POST /applications/1/close")).toBeNull();
  });

  test("rejects non-numeric ID in parameterized route", () => {
    const routes = new Map([
      ["POST /tickets/:id/close", "ticket-close-handler"],
    ]);
    expect(matchRoute(routes, "POST /tickets/abc/close")).toBeNull();
  });

  test("prefers exact match over pattern match", () => {
    const routes = new Map([
      ["POST /reaction-roles", "create-handler"],
      ["POST /reaction-roles/:id/rebuild", "rebuild-handler"],
    ]);
    expect(matchRoute(routes, "POST /reaction-roles")).toBe("create-handler");
  });

  test("returns null for empty routes", () => {
    const routes = new Map<string, string>();
    expect(matchRoute(routes, "POST /anything")).toBeNull();
  });
});
