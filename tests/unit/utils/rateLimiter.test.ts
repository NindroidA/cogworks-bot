/**
 * Rate Limiter Unit Tests
 *
 * Tests the rate limiting functionality to ensure proper enforcement
 * of usage limits.
 */

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { rateLimiter } from "../../../src/utils/security/rateLimiter";

describe("RateLimiter", () => {
  const originalRelease = process.env.RELEASE;

  beforeEach(() => {
    // Set to prod mode so rate limiting is actually enforced
    process.env.RELEASE = "prod";
  });

  afterEach(() => {
    // Clean up the rate limiter's internal cleanup interval
    rateLimiter.destroy();
    // Restore original RELEASE value
    process.env.RELEASE = originalRelease;
  });

  describe("check()", () => {
    test("should allow first attempt", () => {
      const result = rateLimiter.check("user123", {
        maxAttempts: 3,
        windowMs: 60000, // 1 minute
      });

      expect(result.allowed).toBe(true);
      expect(result.message).toBeUndefined();
    });

    test("should allow attempts within limit", () => {
      const config = { maxAttempts: 5, windowMs: 60000 }; // Increase limit to 5

      // First attempt
      const result1 = rateLimiter.check("user-multi", config);
      expect(result1.allowed).toBe(true);

      // Second attempt
      const result2 = rateLimiter.check("user-multi", config);
      expect(result2.allowed).toBe(true);

      // Third attempt
      const result3 = rateLimiter.check("user-multi", config);
      expect(result3.allowed).toBe(true);
    });

    test("should deny attempts exceeding limit", () => {
      const config = { maxAttempts: 2, windowMs: 60000 };

      // First two attempts should succeed
      rateLimiter.check("user123", config);
      rateLimiter.check("user123", config);

      // Third attempt should fail
      const result = rateLimiter.check("user123", config);
      expect(result.allowed).toBe(false);
      expect(result.message).toBeDefined();
      expect(result.resetIn).toBeDefined();
    });

    test("should use custom error message", () => {
      const config = {
        maxAttempts: 1,
        windowMs: 60000,
        message: "Custom rate limit message",
      };

      rateLimiter.check("user123", config);
      const result = rateLimiter.check("user123", config);

      expect(result.allowed).toBe(false);
      expect(result.message).toBe("Custom rate limit message");
    });

    test("should reset after window expires", async () => {
      const config = { maxAttempts: 2, windowMs: 50 }; // 50ms window for fast test

      // Exhaust limit
      rateLimiter.check("user-reset", config);
      rateLimiter.check("user-reset", config);

      // Should be denied
      const deniedResult = rateLimiter.check("user-reset", config);
      expect(deniedResult.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should be allowed again
      const allowedResult = rateLimiter.check("user-reset", config);
      expect(allowedResult.allowed).toBe(true);
    });

    test("should track different keys separately", () => {
      const config = { maxAttempts: 1, windowMs: 60000 };

      // User 1 exhausts limit
      rateLimiter.check("user-a", config);
      const user1Result = rateLimiter.check("user-a", config);
      expect(user1Result.allowed).toBe(false);

      // User 2 should still be allowed
      const user2Result = rateLimiter.check("user-b", config);
      expect(user2Result.allowed).toBe(true);
    });

    test("should calculate correct resetIn time", () => {
      const config = { maxAttempts: 1, windowMs: 60000 };

      rateLimiter.check("user-time", config);
      const result = rateLimiter.check("user-time", config);

      expect(result.resetIn).toBeDefined();
      expect(result.resetIn).toBeGreaterThan(0);
      expect(result.resetIn).toBeLessThanOrEqual(60); // Should be within 60 seconds
    });
  });

  describe("reset()", () => {
    test("should reset specific key", () => {
      const config = { maxAttempts: 1, windowMs: 60000 };

      // Exhaust limits for two users
      rateLimiter.check("user-reset-1", config);
      rateLimiter.check("user-reset-1", config);
      rateLimiter.check("user-reset-2", config);
      rateLimiter.check("user-reset-2", config);

      // Both should be denied
      expect(rateLimiter.check("user-reset-1", config).allowed).toBe(false);
      expect(rateLimiter.check("user-reset-2", config).allowed).toBe(false);

      // Reset only user1
      rateLimiter.reset("user-reset-1");

      // User1 should be allowed, user2 still denied
      expect(rateLimiter.check("user-reset-1", config).allowed).toBe(true);
      expect(rateLimiter.check("user-reset-2", config).allowed).toBe(false);
    });
  });

  describe("getRemaining()", () => {
    test("should return correct remaining attempts", () => {
      const config = { maxAttempts: 5, windowMs: 60000 };

      rateLimiter.check("user-remaining", config);
      rateLimiter.check("user-remaining", config);
      rateLimiter.check("user-remaining", config);

      const remaining = rateLimiter.getRemaining("user-remaining", 5);
      expect(remaining).toBe(2); // 5 max - 3 used
    });

    test("should return maxAttempts for new key", () => {
      const remaining = rateLimiter.getRemaining("new-user", 5);
      expect(remaining).toBe(5);
    });

    test("should return 0 when at limit", () => {
      const config = { maxAttempts: 2, windowMs: 60000 };

      rateLimiter.check("user-zero", config);
      rateLimiter.check("user-zero", config);

      const remaining = rateLimiter.getRemaining("user-zero", 2);
      expect(remaining).toBe(0);
    });
  });

  describe("getResetTime()", () => {
    test("should return 0 for non-existent key", () => {
      const resetTime = rateLimiter.getResetTime("nonexistent-user");
      expect(resetTime).toBe(0);
    });

    test("should return future timestamp for active limit", () => {
      const config = { maxAttempts: 1, windowMs: 60000 };

      rateLimiter.check("user-time-check", config);

      const resetTime = rateLimiter.getResetTime("user-time-check");
      // getResetTime returns seconds remaining, not absolute timestamp
      expect(resetTime).toBeGreaterThan(0);
      expect(resetTime).toBeLessThanOrEqual(60);
    });
  });

  describe("getStats()", () => {
    test("should return current statistics", () => {
      const config = { maxAttempts: 3, windowMs: 60000 };

      // Create some entries
      rateLimiter.check("stats-user-1", config);
      rateLimiter.check("stats-user-2", config);
      rateLimiter.check("stats-user-3", config);

      const stats = rateLimiter.getStats();
      expect(stats.activeEntries).toBeGreaterThan(0);
      expect(stats.totalLimits).toBeGreaterThanOrEqual(stats.activeEntries);
    });
  });

  describe("time formatting in messages", () => {
    test("should format seconds correctly", () => {
      const config = { maxAttempts: 1, windowMs: 45000 }; // 45 seconds

      rateLimiter.check("user-format-sec", config);
      const result = rateLimiter.check("user-format-sec", config);

      expect(result.message).toContain("45 seconds");
    });

    test("should format minutes correctly", () => {
      const config = { maxAttempts: 1, windowMs: 120000 }; // 2 minutes

      rateLimiter.check("user-format-min", config);
      const result = rateLimiter.check("user-format-min", config);

      expect(result.message).toContain("2 minutes");
    });

    test("should format hours correctly", () => {
      const config = { maxAttempts: 1, windowMs: 7200000 }; // 2 hours

      rateLimiter.check("user-format-hr", config);
      const result = rateLimiter.check("user-format-hr", config);

      expect(result.message).toContain("2 hours");
    });
  });
});
