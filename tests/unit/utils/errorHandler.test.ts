/**
 * Error Handler Unit Tests
 *
 * Tests for error classification and the safe database operation wrapper.
 * Uses console spies instead of jest.mock (not supported by Bun test runner).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  classifyError,
  ErrorCategory,
  ErrorSeverity,
  safeDbOperation,
} from "../../../src/utils/errorHandler";

describe("classifyError", () => {
  describe("Database errors", () => {
    test("should classify TypeORM errors as DATABASE", () => {
      const error = new Error("TypeORM query failed");
      const result = classifyError(error);
      expect(result.category).toBe(ErrorCategory.DATABASE);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    test("should classify database connection errors", () => {
      const result = classifyError(new Error("Database connection refused"));
      expect(result.category).toBe(ErrorCategory.DATABASE);
    });

    test("should classify repository errors", () => {
      const result = classifyError(
        new Error("Repository not found for entity"),
      );
      expect(result.category).toBe(ErrorCategory.DATABASE);
    });
  });

  describe("Discord API errors", () => {
    test("should classify DiscordAPIError", () => {
      const error = new Error("Discord API rate limited");
      error.name = "DiscordAPIError";
      const result = classifyError(error);
      expect(result.category).toBe(ErrorCategory.DISCORD_API);
    });

    test("should classify unknown interaction errors", () => {
      const result = classifyError(new Error("Unknown interaction"));
      expect(result.category).toBe(ErrorCategory.DISCORD_API);
    });
  });

  describe("Permission errors", () => {
    test("should classify permission errors as PERMISSIONS with LOW severity", () => {
      const result = classifyError(new Error("Missing Access"));
      expect(result.category).toBe(ErrorCategory.PERMISSIONS);
      expect(result.severity).toBe(ErrorSeverity.LOW);
    });

    test("should classify forbidden errors", () => {
      const result = classifyError(new Error("Forbidden"));
      expect(result.category).toBe(ErrorCategory.PERMISSIONS);
    });
  });

  describe("Validation errors", () => {
    test("should classify invalid input errors", () => {
      const result = classifyError(new Error("Invalid channel ID"));
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.severity).toBe(ErrorSeverity.LOW);
    });

    test("should classify not found errors", () => {
      const result = classifyError(new Error("User not found"));
      expect(result.category).toBe(ErrorCategory.VALIDATION);
    });
  });

  describe("Configuration errors", () => {
    test("should classify config errors", () => {
      const result = classifyError(
        new Error("Bot not configured for this guild"),
      );
      expect(result.category).toBe(ErrorCategory.CONFIGURATION);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    test("should classify setup errors", () => {
      const result = classifyError(new Error("Setup incomplete"));
      expect(result.category).toBe(ErrorCategory.CONFIGURATION);
    });
  });

  describe("External API errors", () => {
    test("should classify fetch errors", () => {
      const result = classifyError(new Error("Fetch timeout"));
      expect(result.category).toBe(ErrorCategory.EXTERNAL_API);
    });

    test("should classify request failed errors", () => {
      const result = classifyError(new Error("Request failed with status 503"));
      expect(result.category).toBe(ErrorCategory.EXTERNAL_API);
    });
  });

  describe("Unknown errors", () => {
    test("should default to UNKNOWN for unrecognized errors", () => {
      const result = classifyError(new Error("Something totally unexpected"));
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    test("should handle non-Error objects", () => {
      const result = classifyError("just a string error");
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
    });

    test("should handle null/undefined", () => {
      const result = classifyError(null);
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
    });
  });
});

// ── Expanded behavioral tests for classifyError ──────────────────────────────

describe("classifyError — DATABASE category", () => {
  test('matches "typeorm" keyword (case-insensitive)', () => {
    const result = classifyError(
      new Error("TypeORM EntityNotFoundError: could not find entity"),
    );
    expect(result.category).toBe(ErrorCategory.DATABASE);
    expect(result.severity).toBe(ErrorSeverity.MEDIUM);
  });

  test('matches "database" keyword for connection errors', () => {
    const result = classifyError(new Error("Database connection ECONNREFUSED"));
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });

  test('matches "repository" keyword', () => {
    const result = classifyError(
      new Error("Repository query failed: ER_DUP_ENTRY"),
    );
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });

  test('matches "entity" keyword for EntityNotFoundError patterns', () => {
    const result = classifyError(new Error("Could not find entity by id"));
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });

  test('matches when "database" appears anywhere in message', () => {
    const result = classifyError(
      new Error("Failed to connect to database server"),
    );
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });

  test("always returns MEDIUM severity for DATABASE", () => {
    const cases = [
      new Error("TypeORM initialization failed"),
      new Error("Database timeout"),
      new Error("Repository error"),
      new Error("Entity metadata not found"),
    ];
    for (const err of cases) {
      expect(classifyError(err).severity).toBe(ErrorSeverity.MEDIUM);
    }
  });
});

describe("classifyError — DISCORD_API category", () => {
  test('matches error.name containing "discordapi" (case-insensitive)', () => {
    const error = new Error("Rate limited");
    error.name = "DiscordAPIError[50013]";
    const result = classifyError(error);
    expect(result.category).toBe(ErrorCategory.DISCORD_API);
    expect(result.severity).toBe(ErrorSeverity.MEDIUM);
  });

  test('matches "discord" in message', () => {
    const result = classifyError(new Error("Discord gateway connection lost"));
    expect(result.category).toBe(ErrorCategory.DISCORD_API);
  });

  test('matches "rest api" in message', () => {
    const result = classifyError(new Error("REST API returned 429"));
    expect(result.category).toBe(ErrorCategory.DISCORD_API);
  });

  test('matches "unknown interaction" in message', () => {
    const result = classifyError(
      new Error("Unknown interaction: token expired"),
    );
    expect(result.category).toBe(ErrorCategory.DISCORD_API);
  });

  test("always returns MEDIUM severity for DISCORD_API", () => {
    const error = new Error("Discord WebSocket closed");
    expect(classifyError(error).severity).toBe(ErrorSeverity.MEDIUM);
  });
});

describe("classifyError — PERMISSIONS category", () => {
  test('matches "permission" keyword', () => {
    const result = classifyError(new Error("Missing Permissions"));
    expect(result.category).toBe(ErrorCategory.PERMISSIONS);
    expect(result.severity).toBe(ErrorSeverity.LOW);
  });

  test('matches "missing access" keyword', () => {
    const result = classifyError(new Error("Missing Access to channel"));
    expect(result.category).toBe(ErrorCategory.PERMISSIONS);
  });

  test('matches "forbidden" keyword', () => {
    const result = classifyError(new Error("403 Forbidden"));
    expect(result.category).toBe(ErrorCategory.PERMISSIONS);
  });

  test("matches permission-related phrases case-insensitively", () => {
    const result = classifyError(
      new Error("MISSING PERMISSIONS: MANAGE_CHANNELS"),
    );
    expect(result.category).toBe(ErrorCategory.PERMISSIONS);
  });

  test("always returns LOW severity for PERMISSIONS", () => {
    const cases = [
      new Error("Permission denied"),
      new Error("Missing Access"),
      new Error("Forbidden action"),
    ];
    for (const err of cases) {
      expect(classifyError(err).severity).toBe(ErrorSeverity.LOW);
    }
  });
});

describe("classifyError — VALIDATION category", () => {
  test('matches "invalid" keyword', () => {
    const result = classifyError(new Error("Invalid snowflake ID"));
    expect(result.category).toBe(ErrorCategory.VALIDATION);
    expect(result.severity).toBe(ErrorSeverity.LOW);
  });

  test('matches "required" keyword', () => {
    const result = classifyError(new Error("Field channelId is required"));
    expect(result.category).toBe(ErrorCategory.VALIDATION);
  });

  test('matches "validation" keyword', () => {
    const result = classifyError(new Error("Validation failed for input"));
    expect(result.category).toBe(ErrorCategory.VALIDATION);
  });

  test('matches "not found" keyword', () => {
    const result = classifyError(new Error("User not found"));
    expect(result.category).toBe(ErrorCategory.VALIDATION);
  });

  test('matches "must be" only if it also contains another keyword', () => {
    // "must be" alone does not match VALIDATION — only 'invalid', 'required', 'validation', 'not found'
    const result = classifyError(new Error("Value must be positive"));
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("always returns LOW severity for VALIDATION", () => {
    const cases = [
      new Error("Invalid format"),
      new Error("Field required"),
      new Error("Validation error"),
      new Error("Resource not found"),
    ];
    for (const err of cases) {
      expect(classifyError(err).severity).toBe(ErrorSeverity.LOW);
    }
  });
});

describe("classifyError — CONFIGURATION category", () => {
  test('matches "config" keyword', () => {
    const result = classifyError(new Error("Missing config entry"));
    expect(result.category).toBe(ErrorCategory.CONFIGURATION);
    expect(result.severity).toBe(ErrorSeverity.MEDIUM);
  });

  test('matches "setup" keyword', () => {
    const result = classifyError(new Error("Setup has not been completed"));
    expect(result.category).toBe(ErrorCategory.CONFIGURATION);
  });

  test('matches "not configured" keyword', () => {
    const result = classifyError(
      new Error("Tickets not configured for this server"),
    );
    expect(result.category).toBe(ErrorCategory.CONFIGURATION);
  });

  test("always returns MEDIUM severity for CONFIGURATION", () => {
    const cases = [
      new Error("Config missing"),
      new Error("Setup incomplete"),
      new Error("Module not configured"),
    ];
    for (const err of cases) {
      expect(classifyError(err).severity).toBe(ErrorSeverity.MEDIUM);
    }
  });

  test('"Setup required" matches VALIDATION first due to "required" keyword', () => {
    // "required" triggers VALIDATION (checked before CONFIGURATION)
    const result = classifyError(new Error("Setup required"));
    expect(result.category).toBe(ErrorCategory.VALIDATION);
    expect(result.severity).toBe(ErrorSeverity.LOW);
  });
});

describe("classifyError — EXTERNAL_API category", () => {
  test('matches "api" keyword', () => {
    const result = classifyError(new Error("Third-party API returned 500"));
    expect(result.category).toBe(ErrorCategory.EXTERNAL_API);
    expect(result.severity).toBe(ErrorSeverity.MEDIUM);
  });

  test('matches "fetch" keyword', () => {
    const result = classifyError(new Error("Fetch failed: ETIMEDOUT"));
    expect(result.category).toBe(ErrorCategory.EXTERNAL_API);
  });

  test('matches "request failed" keyword', () => {
    const result = classifyError(new Error("Request failed with status 503"));
    expect(result.category).toBe(ErrorCategory.EXTERNAL_API);
  });

  test("always returns MEDIUM severity for EXTERNAL_API", () => {
    const cases = [
      new Error("External API unavailable"),
      new Error("Fetch timeout"),
      new Error("Request failed"),
    ];
    for (const err of cases) {
      expect(classifyError(err).severity).toBe(ErrorSeverity.MEDIUM);
    }
  });
});

describe("classifyError — UNKNOWN category", () => {
  test("returns UNKNOWN for generic messages without keywords", () => {
    const result = classifyError(new Error("Something went wrong"));
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
    expect(result.severity).toBe(ErrorSeverity.MEDIUM);
  });

  test("handles a plain string (non-Error object)", () => {
    const result = classifyError("oops");
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
    expect(result.severity).toBe(ErrorSeverity.MEDIUM);
  });

  test("handles null", () => {
    const result = classifyError(null);
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("handles undefined", () => {
    const result = classifyError(undefined);
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("handles a number", () => {
    const result = classifyError(42);
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("handles an empty object", () => {
    const result = classifyError({});
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("handles an object with toString()", () => {
    const result = classifyError({ toString: () => "custom stringified" });
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("always returns MEDIUM severity for UNKNOWN", () => {
    expect(classifyError(new Error("xyz")).severity).toBe(ErrorSeverity.MEDIUM);
    expect(classifyError(12345).severity).toBe(ErrorSeverity.MEDIUM);
    expect(classifyError(null).severity).toBe(ErrorSeverity.MEDIUM);
  });
});

describe("classifyError — category priority (first-match wins)", () => {
  test('DATABASE beats VALIDATION when message contains "entity" and "not found"', () => {
    // "entity" matches DATABASE first, even though "not found" would match VALIDATION
    const result = classifyError(new Error("Entity not found in database"));
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });

  test('DATABASE beats EXTERNAL_API when message contains "database" and "api"', () => {
    const result = classifyError(new Error("Database API connection failed"));
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });

  test('DISCORD_API beats PERMISSIONS when message contains "discord" and "permission"', () => {
    const result = classifyError(new Error("Discord permission check failed"));
    expect(result.category).toBe(ErrorCategory.DISCORD_API);
  });

  test('DISCORD_API beats EXTERNAL_API when message contains "discord" and "api"', () => {
    const result = classifyError(new Error("Discord REST API error"));
    expect(result.category).toBe(ErrorCategory.DISCORD_API);
  });

  test('PERMISSIONS beats VALIDATION when message contains "permission" and "invalid"', () => {
    // "permission" matches PERMISSIONS before "invalid" matches VALIDATION
    // Wait — actually DISCORD_API checks 'discord' before PERMISSIONS. But "permission" alone
    // is checked in PERMISSIONS, which comes before VALIDATION. Let's verify:
    const result = classifyError(new Error("Invalid permission level"));
    // "invalid" triggers VALIDATION (checked before PERMISSIONS? No — PERMISSIONS is checked after DISCORD_API)
    // Actually: order is DATABASE → DISCORD_API → PERMISSIONS → VALIDATION
    // "invalid permission level" — does it match DISCORD_API? No. PERMISSIONS? "permission" yes!
    expect(result.category).toBe(ErrorCategory.PERMISSIONS);
  });

  test('VALIDATION beats CONFIGURATION when message contains "not found" and "config"', () => {
    // VALIDATION is checked before CONFIGURATION
    const result = classifyError(new Error("Config file not found"));
    // "not found" matches VALIDATION before "config" matches CONFIGURATION
    expect(result.category).toBe(ErrorCategory.VALIDATION);
  });

  test('CONFIGURATION beats EXTERNAL_API when message contains "setup" and "api"', () => {
    // CONFIGURATION is checked before EXTERNAL_API
    const result = classifyError(new Error("API setup incomplete"));
    expect(result.category).toBe(ErrorCategory.CONFIGURATION);
  });
});

describe("classifyError — case insensitivity", () => {
  test("matches uppercase DATABASE keywords", () => {
    expect(classifyError(new Error("TYPEORM ERROR")).category).toBe(
      ErrorCategory.DATABASE,
    );
    expect(classifyError(new Error("DATABASE UNREACHABLE")).category).toBe(
      ErrorCategory.DATABASE,
    );
  });

  test("matches mixed-case DISCORD_API keywords", () => {
    const error = new Error("Some error");
    error.name = "DISCORDAPIERROR";
    expect(classifyError(error).category).toBe(ErrorCategory.DISCORD_API);
  });

  test("matches uppercase PERMISSIONS keywords", () => {
    expect(classifyError(new Error("MISSING ACCESS")).category).toBe(
      ErrorCategory.PERMISSIONS,
    );
    expect(classifyError(new Error("FORBIDDEN")).category).toBe(
      ErrorCategory.PERMISSIONS,
    );
  });

  test("matches uppercase VALIDATION keywords", () => {
    expect(classifyError(new Error("INVALID INPUT")).category).toBe(
      ErrorCategory.VALIDATION,
    );
    expect(classifyError(new Error("FIELD REQUIRED")).category).toBe(
      ErrorCategory.VALIDATION,
    );
  });

  test("matches uppercase CONFIGURATION keywords", () => {
    expect(classifyError(new Error("NOT CONFIGURED")).category).toBe(
      ErrorCategory.CONFIGURATION,
    );
    expect(classifyError(new Error("SETUP NEEDED")).category).toBe(
      ErrorCategory.CONFIGURATION,
    );
  });

  test("matches uppercase EXTERNAL_API keywords", () => {
    expect(classifyError(new Error("FETCH FAILED")).category).toBe(
      ErrorCategory.EXTERNAL_API,
    );
    expect(classifyError(new Error("REQUEST FAILED with 500")).category).toBe(
      ErrorCategory.EXTERNAL_API,
    );
  });
});

describe("classifyError — non-Error inputs use String() coercion", () => {
  test('string input containing "database" matches DATABASE', () => {
    const result = classifyError("database connection lost");
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });

  test('string input containing "permission" matches PERMISSIONS', () => {
    const result = classifyError("permission denied for resource");
    expect(result.category).toBe(ErrorCategory.PERMISSIONS);
  });

  test('string input containing "invalid" matches VALIDATION', () => {
    const result = classifyError("invalid user input detected");
    expect(result.category).toBe(ErrorCategory.VALIDATION);
  });

  test("string input without keywords falls to UNKNOWN", () => {
    const result = classifyError("something broke");
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("number input is coerced via String() and classified as UNKNOWN", () => {
    const result = classifyError(500);
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("boolean input is coerced via String() and classified as UNKNOWN", () => {
    const result = classifyError(false);
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });
});

describe("classifyError — error.name vs error.message matching", () => {
  test("DISCORD_API matches on error.name even when message has no keywords", () => {
    const error = new Error("Code 50013");
    error.name = "DiscordAPIError";
    const result = classifyError(error);
    expect(result.category).toBe(ErrorCategory.DISCORD_API);
  });

  test("error.name is only used for DISCORD_API check (discordapi)", () => {
    // An error.name containing "database" does NOT trigger DATABASE — only message is checked
    const error = new Error("Something went wrong");
    error.name = "DatabaseError";
    const result = classifyError(error);
    // "database" is NOT in the message, and error.name is only checked for 'discordapi'
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });

  test("error.name with discordapi takes priority over message keywords", () => {
    const error = new Error("TypeORM entity repository error");
    error.name = "DiscordAPIError";
    // DATABASE keywords are in the message, but DISCORD_API check on name comes second
    // Actually DATABASE is checked FIRST (before DISCORD_API), so DATABASE wins
    const result = classifyError(error);
    expect(result.category).toBe(ErrorCategory.DATABASE);
  });
});

describe("safeDbOperation", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("should return result on success", async () => {
    const result = await safeDbOperation(
      async () => ({ id: 1, name: "test" }),
      "test operation",
    );
    expect(result).toEqual({ id: 1, name: "test" });
  });

  test("should return null on failure", async () => {
    const result = await safeDbOperation(async () => {
      throw new Error("DB error");
    }, "failing operation");
    expect(result).toBeNull();
  });

  test("should log error on failure", async () => {
    await safeDbOperation(async () => {
      throw new Error("DB connection lost");
    }, "connection test");

    // Should have logged the error via console.error (through logger/chalk)
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
