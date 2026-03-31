import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  RateLimits,
  createRateLimitKey,
  rateLimiter,
} from "../../../src/utils/security/rateLimiter";

describe("RateLimiter", () => {
  const orig = process.env.RELEASE;
  beforeEach(() => {
    process.env.RELEASE = "prod";
  });
  afterEach(() => {
    rateLimiter.destroy();
    process.env.RELEASE = orig;
  });

  test("allows first", () => {
    expect(
      rateLimiter.check("t1", { maxAttempts: 3, windowMs: 60000 }).allowed,
    ).toBe(true);
  });
  test("denies over limit", () => {
    const c = { maxAttempts: 2, windowMs: 60000 };
    rateLimiter.check("t2", c);
    rateLimiter.check("t2", c);
    expect(rateLimiter.check("t2", c).allowed).toBe(false);
  });
  test("reset clears", () => {
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check("t3", c);
    rateLimiter.check("t3", c);
    rateLimiter.reset("t3");
    expect(rateLimiter.check("t3", c).allowed).toBe(true);
  });
  test("keys independent", () => {
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check("a", c);
    rateLimiter.check("a", c);
    expect(rateLimiter.check("b", c).allowed).toBe(true);
  });
  test("window expiry", async () => {
    const c = { maxAttempts: 1, windowMs: 50 };
    rateLimiter.check("t4", c);
    expect(rateLimiter.check("t4", c).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(rateLimiter.check("t4", c).allowed).toBe(true);
  });
  test("getSize increases", () => {
    const c = { maxAttempts: 5, windowMs: 60000 };
    const b = rateLimiter.getSize();
    rateLimiter.check("s1", c);
    rateLimiter.check("s2", c);
    expect(rateLimiter.getSize()).toBe(b + 2);
  });
  test("dev mode bypasses", () => {
    process.env.RELEASE = "dev";
    rateLimiter.destroy();
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check("d1", c);
    expect(rateLimiter.check("d1", c).allowed).toBe(true);
  });
  test("denied has message", () => {
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check("m1", c);
    const r = rateLimiter.check("m1", c);
    expect(r.message).toBeDefined();
    expect(r.resetIn).toBeGreaterThan(0);
  });
});

describe("createRateLimitKey", () => {
  test("user", () => {
    expect(createRateLimitKey.user("123", "ticket")).toBe("user:123:ticket");
  });
  test("guild", () => {
    expect(createRateLimitKey.guild("456", "export")).toBe("guild:456:export");
  });
  test("globalUser", () => {
    expect(createRateLimitKey.globalUser("789")).toBe("global:user:789");
  });
});

describe("RateLimits", () => {
  test("all have shape", () => {
    for (const k of Object.keys(RateLimits)) {
      const c = RateLimits[k as keyof typeof RateLimits];
      expect(c.maxAttempts).toBeGreaterThan(0);
      expect(c.windowMs).toBeGreaterThan(0);
    }
  });
  test("TICKET_CREATE 3/hr", () => {
    expect(RateLimits.TICKET_CREATE.maxAttempts).toBe(3);
  });
  test("GLOBAL_COMMAND 30/min", () => {
    expect(RateLimits.GLOBAL_COMMAND.maxAttempts).toBe(30);
  });
});

describe("RateLimiter - getRemaining", () => {
  const orig = process.env.RELEASE;
  beforeEach(() => {
    process.env.RELEASE = "prod";
  });
  afterEach(() => {
    rateLimiter.destroy();
    process.env.RELEASE = orig;
  });

  test("returns maxAttempts when no entry exists", () => {
    expect(rateLimiter.getRemaining("nonexistent", 5)).toBe(5);
  });

  test("returns maxAttempts when entry expired", async () => {
    const c = { maxAttempts: 3, windowMs: 50 };
    rateLimiter.check("expire-rem", c);
    await new Promise((r) => setTimeout(r, 60));
    expect(rateLimiter.getRemaining("expire-rem", 3)).toBe(3);
  });

  test("decreases as checks consume attempts", () => {
    const c = { maxAttempts: 5, windowMs: 60000 };
    rateLimiter.check("dec1", c);
    expect(rateLimiter.getRemaining("dec1", 5)).toBe(4);
    rateLimiter.check("dec1", c);
    expect(rateLimiter.getRemaining("dec1", 5)).toBe(3);
    rateLimiter.check("dec1", c);
    expect(rateLimiter.getRemaining("dec1", 5)).toBe(2);
  });

  test("returns 0 when fully consumed", () => {
    const c = { maxAttempts: 2, windowMs: 60000 };
    rateLimiter.check("full1", c);
    rateLimiter.check("full1", c);
    expect(rateLimiter.getRemaining("full1", 2)).toBe(0);
  });
});

describe("RateLimiter - getResetTime", () => {
  const orig = process.env.RELEASE;
  beforeEach(() => {
    process.env.RELEASE = "prod";
  });
  afterEach(() => {
    rateLimiter.destroy();
    process.env.RELEASE = orig;
  });

  test("returns 0 when no entry", () => {
    expect(rateLimiter.getResetTime("no-entry")).toBe(0);
  });

  test("returns 0 when entry expired", async () => {
    const c = { maxAttempts: 3, windowMs: 50 };
    rateLimiter.check("expire-reset", c);
    await new Promise((r) => setTimeout(r, 60));
    expect(rateLimiter.getResetTime("expire-reset")).toBe(0);
  });

  test("returns positive number when entry active", () => {
    const c = { maxAttempts: 3, windowMs: 60000 };
    rateLimiter.check("active-reset", c);
    const resetTime = rateLimiter.getResetTime("active-reset");
    expect(resetTime).toBeGreaterThan(0);
    expect(resetTime).toBeLessThanOrEqual(60);
  });
});

describe("RateLimiter - getStats", () => {
  const orig = process.env.RELEASE;
  beforeEach(() => {
    process.env.RELEASE = "prod";
  });
  afterEach(() => {
    rateLimiter.destroy();
    process.env.RELEASE = orig;
  });

  test("returns consistent active/total counts", () => {
    // Singleton retains entries from prior tests, so use relative counts
    const baseline = rateLimiter.getStats();
    expect(baseline.activeEntries).toBeGreaterThanOrEqual(0);
    expect(baseline.totalLimits).toBeGreaterThanOrEqual(baseline.activeEntries);
  });

  test("counts new active entries correctly", () => {
    const baseline = rateLimiter.getStats();
    const c = { maxAttempts: 5, windowMs: 60000 };
    rateLimiter.check("stat1", c);
    rateLimiter.check("stat2", c);
    rateLimiter.check("stat3", c);
    const stats = rateLimiter.getStats();
    expect(stats.activeEntries).toBe(baseline.activeEntries + 3);
    expect(stats.totalLimits).toBe(baseline.totalLimits + 3);
  });

  test("expired entries not counted as active", async () => {
    const baseline = rateLimiter.getStats();
    const shortWindow = { maxAttempts: 5, windowMs: 50 };
    const longWindow = { maxAttempts: 5, windowMs: 60000 };
    rateLimiter.check("short-lived", shortWindow);
    rateLimiter.check("long-lived", longWindow);
    await new Promise((r) => setTimeout(r, 60));
    const stats = rateLimiter.getStats();
    // Only the long-lived entry should be active relative to baseline
    expect(stats.activeEntries).toBe(baseline.activeEntries + 1);
    // Both entries still exist in the map
    expect(stats.totalLimits).toBe(baseline.totalLimits + 2);
  });
});

describe("createRateLimitKey - userGuild", () => {
  test("formats user+guild+action key", () => {
    expect(createRateLimitKey.userGuild("123", "456", "ticket")).toBe(
      "user:123:guild:456:ticket",
    );
  });
});

describe("RateLimiter - custom message in config", () => {
  const orig = process.env.RELEASE;
  beforeEach(() => {
    process.env.RELEASE = "prod";
  });
  afterEach(() => {
    rateLimiter.destroy();
    process.env.RELEASE = orig;
  });

  test("uses config.message when provided and denied", () => {
    const c = {
      maxAttempts: 1,
      windowMs: 60000,
      message: "Custom limit message",
    };
    rateLimiter.check("cm1", c);
    const r = rateLimiter.check("cm1", c);
    expect(r.allowed).toBe(false);
    expect(r.message).toBe("Custom limit message");
  });

  test("uses default format when no config.message and denied", () => {
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check("cm2", c);
    const r = rateLimiter.check("cm2", c);
    expect(r.allowed).toBe(false);
    expect(r.message).toMatch(/^Rate limit exceeded\. Try again in .+\.$/);
  });
});

describe("RateLimiter - formatTime edge cases (via denied messages)", () => {
  const orig = process.env.RELEASE;
  beforeEach(() => {
    process.env.RELEASE = "prod";
  });
  afterEach(() => {
    rateLimiter.destroy();
    process.env.RELEASE = orig;
  });

  test("seconds format", () => {
    const c = { maxAttempts: 1, windowMs: 30_000 }; // 30 seconds
    rateLimiter.check("fmt-sec", c);
    const r = rateLimiter.check("fmt-sec", c);
    expect(r.message).toMatch(/\d+ seconds?\./);
  });

  test("singular second", () => {
    const c = { maxAttempts: 1, windowMs: 1_000 }; // 1 second
    rateLimiter.check("fmt-1sec", c);
    const r = rateLimiter.check("fmt-1sec", c);
    expect(r.message).toMatch(/1 second\./);
  });

  test("minutes format", () => {
    const c = { maxAttempts: 1, windowMs: 5 * 60_000 }; // 5 minutes
    rateLimiter.check("fmt-min", c);
    const r = rateLimiter.check("fmt-min", c);
    expect(r.message).toMatch(/\d+ minutes?\./);
  });

  test("hours format (exact hours)", () => {
    const c = { maxAttempts: 1, windowMs: 2 * 60 * 60_000 }; // 2 hours
    rateLimiter.check("fmt-hr", c);
    const r = rateLimiter.check("fmt-hr", c);
    expect(r.message).toMatch(/\d+ hours?\./);
    // Should NOT contain "and X minutes" since it's exact hours
    expect(r.message).not.toMatch(/and \d+ minutes?/);
  });

  test("hours and minutes format", () => {
    const c = { maxAttempts: 1, windowMs: 1.5 * 60 * 60_000 }; // 1 hour 30 min
    rateLimiter.check("fmt-hr-min", c);
    const r = rateLimiter.check("fmt-hr-min", c);
    expect(r.message).toMatch(/\d+ hours? and \d+ minutes?\./);
  });
});
