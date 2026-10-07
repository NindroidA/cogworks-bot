import { describe, expect, mock, spyOn, test } from "bun:test";
import { DiscordAPIError, SnowflakeUtil } from "discord.js";
import {
  executeBanAction,
  IDEMPOTENCY_TTL_MS,
} from "../../../../src/utils/baitChannel/banExecutor";
import { enhancedLogger } from "../../../../src/utils/monitoring/enhancedLogger";

/**
 * Minimal fake `Repository<IdempotencyKey>`: rows in a Map keyed like the
 * UNIQUE index (guildId, userId, action, dayBucket), so a colliding save()
 * throws like TypeORM would. find/findOne/delete match on the given fields.
 */
function makeIdempotencyRepo() {
  const rows = new Map<string, any>();
  const key = (r: any) =>
    `${r.guildId}|${r.userId}|${r.action}|${r.dayBucket.toISOString().slice(0, 10)}`;
  const matches = (row: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    create: (entity: unknown) => entity,
    save: mock(async (entity: any) => {
      const k = key(entity);
      if (rows.has(k)) throw new Error("UNIQUE constraint failed (test fake)");
      rows.set(k, entity);
      return entity;
    }),
    find: mock(async ({ where }: { where: Record<string, unknown> }) =>
      [...rows.values()].filter((r) => matches(r, where)),
    ),
    findOne: mock(
      async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].find((r) => matches(r, where)) ?? null,
    ),
    delete: mock(async (where: Record<string, unknown>) => {
      for (const [k, r] of rows) if (matches(r, where)) rows.delete(k);
      return { affected: 1 };
    }),
    update: mock(async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
      for (const r of rows.values()) if (matches(r, where)) Object.assign(r, patch);
      return { affected: 1 };
    }),
  };
}

/** A key as auditLogEntryCreate writes it when a mod acts (or ours, with `executorId: 'bot'`), `agoMs` ago. */
function seedModKey(repo: ReturnType<typeof makeIdempotencyRepo>, action: string, agoMs: number, executorId = "mod") {
  const row = {
    guildId: "g1",
    userId: "u1",
    action,
    dayBucket: new Date("2026-10-05T00:00:00Z"),
    executorId,
    testMode: false,
    expiresAt: new Date(Date.now() - agoMs + IDEMPOTENCY_TTL_MS),
  };
  repo.rows.set(`seed-${action}`, row);
}

/** A bait message ID (snowflake) for a post made `agoMs` ago. */
const postedAgo = (agoMs: number) =>
  String(SnowflakeUtil.generate({ timestamp: Date.now() - agoMs }));

const apiError = (code: number, status: number) =>
  new DiscordAPIError({ message: `error ${code}`, code }, code, status, "PUT", "/bans", {
    body: undefined,
    files: undefined,
  });

function makeFakeGuild(id = "g1") {
  return {
    id,
    bans: {
      create: mock(async () => undefined),
      remove: mock(async () => undefined),
      // The ban an earlier softban placed (reason prefix 'Softban — ').
      fetch: mock(async (): Promise<{ reason: string | null }> => ({ reason: "Softban — cogworks:bait score=70" })),
    },
  };
}

function run(guild: any, repo: any, opts: Record<string, unknown> = {}) {
  return executeBanAction(
    {
      guild,
      userId: "u1",
      action: "ban",
      eventId: "m1",
      reason: "cogworks:bait score=90",
      executorId: "bot",
      softbanDelayMs: 0,
      ...opts,
    } as any,
    repo as any,
  );
}

describe("executeBanAction", () => {
  test("ban path calls guild.bans.create via REST and returns executed", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await run(guild, repo, { deleteMessageSeconds: 24 * 3600 });
    expect(result.status).toBe("executed");
    expect(result.action).toBe("ban");
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
  });

  test("the same post twice: the second call is a duplicate and Discord is called once", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    await run(guild, repo);
    const second = await run(guild, repo);
    expect(second.status).toBe("duplicate");
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
  });

  test("softban: ban then unban", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await run(guild, repo, { action: "softban", deleteMessageSeconds: 3600 });
    expect(result.status).toBe("executed");
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(guild.bans.remove).toHaveBeenCalledTimes(1);
    // The ban carries the reason prefix an `unban` step requires.
    expect((guild.bans.create.mock.calls[0] as any[])[1].reason.startsWith("Softban — ")).toBe(true);
  });

  test("log-only: claims the key but does not call Discord", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await run(guild, repo, { action: "log-only" });
    expect(result.status).toBe("executed");
    expect(guild.bans.create).not.toHaveBeenCalled();
    expect(repo.rows.size).toBe(1);
  });

  test("test mode: claims a test-mode key but skips Discord", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await run(guild, repo, { testMode: true });
    expect(result.status).toBe("executed");
    expect(guild.bans.create).not.toHaveBeenCalled();
    expect([...repo.rows.values()][0].testMode).toBe(true);
  });

  test("timeout without member ref → failed (no API call)", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await run(guild, repo, { action: "timeout", timeoutMs: 60_000 });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("GuildMember ref");
  });

  test("database down → queued, never skipped as a duplicate", async () => {
    const repo = makeIdempotencyRepo();
    repo.find = mock(async () => {
      throw new Error("db down");
    });
    const guild = makeFakeGuild();
    const result = await run(guild, repo);
    expect(result.status).toBe("queued");
    expect(guild.bans.create).not.toHaveBeenCalled();
  });
});

describe("a failed action can be retried (#27)", () => {
  test("a retryable failure releases the claim, so the retry of the same post really runs", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    guild.bans.create.mockImplementationOnce(async () => {
      throw apiError(0, 503);
    });
    const first = await run(guild, repo);
    expect(first.status).toBe("queued");
    expect(repo.rows.size).toBe(0);

    const retry = await run(guild, repo);
    expect(retry.status).toBe("executed");
    expect(guild.bans.create).toHaveBeenCalledTimes(2);
  });

  test("a terminal failure releases the claim too (permission restored later)", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    guild.bans.create.mockImplementationOnce(async () => {
      throw apiError(50013, 403);
    });
    expect((await run(guild, repo)).status).toBe("failed");
    expect((await run(guild, repo)).status).toBe("executed");
  });

  test("a softban whose unban fails keeps its claim and retries only the unban", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    guild.bans.remove.mockImplementationOnce(async () => {
      throw apiError(0, 500);
    });
    const first = await run(guild, repo, { action: "softban" });
    expect(first.status).toBe("queued");
    expect(first.retryAction).toBe("unban");
    // Rerunning the softban for this post never bans again: it goes on as the unban.
    const rerun = await run(guild, repo, { action: "softban" });
    expect(rerun.retryAction).toBe("unban");

    const unban = await run(guild, repo, { action: "unban" });
    expect(unban.status).toBe("executed");
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(guild.bans.remove).toHaveBeenCalledTimes(2);
  });

  test("an unban of a ban that is already gone (10026) counts as done", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    guild.bans.fetch.mockImplementationOnce(async () => {
      throw apiError(10026, 404);
    });
    expect((await run(guild, repo, { action: "unban" })).status).toBe("executed");
    expect(guild.bans.remove).not.toHaveBeenCalled();
  });

  test("an unban whose ban list can't be read is retried, never guessed", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    guild.bans.fetch.mockImplementationOnce(async () => {
      throw apiError(0, 503);
    });
    expect((await run(guild, repo, { action: "unban" })).status).toBe("queued");
    expect(guild.bans.remove).not.toHaveBeenCalled();
  });

  test("an unban whose ban a mod lifts between our fetch and our remove (10026) is done", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    guild.bans.remove.mockImplementationOnce(async () => {
      throw apiError(10026, 404);
    });
    expect((await run(guild, repo, { action: "unban" })).status).toBe("executed");
  });

  test("an unban never lifts a ban our softban didn't place", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const warn = spyOn(enhancedLogger, "warn");
    guild.bans.fetch.mockImplementationOnce(async () => ({ reason: "Raid account, banned by a mod" }));
    expect((await run(guild, repo, { action: "unban" })).status).toBe("duplicate");
    // Logged with the reason, so a mod can see whose ban it was.
    expect((warn.mock.calls.at(-1) as any[])[2]).toMatchObject({ banReason: "Raid account, banned by a mod" });
    warn.mockRestore();
    guild.bans.fetch.mockImplementationOnce(async () => ({ reason: null }));
    expect((await run(guild, repo, { action: "unban" })).status).toBe("duplicate");
    expect(guild.bans.remove).not.toHaveBeenCalled();
  });
});

describe("idempotency is per post, not per day (#30)", () => {
  test("softbanned an hour ago, rejoined and posted again → acted on again", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    await run(guild, repo, { action: "softban", eventId: postedAgo(61 * 60_000) });
    // The softban happened an hour ago.
    for (const row of repo.rows.values()) row.expiresAt = new Date(row.expiresAt.getTime() - 60 * 60_000);

    const again = await run(guild, repo, { action: "softban", eventId: postedAgo(60_000) });
    expect(again.status).toBe("executed");
    expect(guild.bans.create).toHaveBeenCalledTimes(2);
  });

  test("a post made before the user was banned is covered by that ban (a burst)", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    await run(guild, repo, { eventId: postedAgo(5_000) });
    const burst = await run(guild, repo, { eventId: postedAgo(3_000) });
    expect(burst.status).toBe("duplicate");
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
  });

  test("a test-mode dry run never covers the real action, even for the same post", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    await run(guild, repo, { testMode: true });
    const real = await run(guild, repo);
    expect(real.status).toBe("executed");
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
  });

  test("a mod's timeout covers posts made before it, not posts made after it expired", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const member = { timeout: mock(async () => undefined) };
    seedModKey(repo, "timeout", 10 * 60_000);
    const opts = { action: "timeout", timeoutMs: 60_000, member };

    const before = await run(guild, repo, { ...opts, eventId: postedAgo(20 * 60_000) });
    expect(before.status).toBe("duplicate");
    const after = await run(guild, repo, { ...opts, eventId: postedAgo(60_000) });
    expect(after.status).toBe("executed");
    expect(member.timeout).toHaveBeenCalledTimes(1);
  });

  test("finishing a softban never lifts a ban taken since the post", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    seedModKey(repo, "ban", 60_000);
    const result = await run(guild, repo, { action: "unban", eventId: postedAgo(5 * 60_000) });
    expect(result.status).toBe("duplicate");
    expect(guild.bans.remove).not.toHaveBeenCalled();
  });
});

describe("review fixes", () => {
  test("an unban is never a dry run, even in test mode: it undoes our own ban", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await run(guild, repo, { action: "unban", testMode: true });
    expect(result.status).toBe("executed");
    expect(guild.bans.remove).toHaveBeenCalledTimes(1);
  });

  test("the key is dated when the action lands: a post made while a slow ban was in flight is covered", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    // P1's claim was made 2s ago and the rate-limited ban only lands now.
    guild.bans.create.mockImplementationOnce(async () => {
      for (const row of repo.rows.values()) row.expiresAt = new Date(Date.now() - 2_000 + IDEMPOTENCY_TTL_MS);
    });
    expect((await run(guild, repo, { eventId: postedAgo(10_000) })).status).toBe("executed");
    const p2 = await run(guild, repo, { eventId: postedAgo(500) });
    expect(p2.status).toBe("duplicate");
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
  });

  test("a longer timeout already in place (a mod's) is never shortened", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const member = {
      timeout: mock(async () => undefined),
      communicationDisabledUntilTimestamp: Date.now() + 2 * 60 * 60_000,
    };
    const result = await run(guild, repo, { action: "timeout", timeoutMs: 60 * 60_000, member });
    expect(result.status).toBe("duplicate");
    expect(member.timeout).not.toHaveBeenCalled();
    expect(repo.rows.size).toBe(0);
  });

  test("a softban retry cut off between its ban and unban (restart) finishes as an unban", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const post = postedAgo(60_000);
    seedModKey(repo, `softban:${post}`, 30_000, "bot");
    const retry = await run(guild, repo, { action: "softban", eventId: post });
    expect(retry.status).toBe("queued");
    expect(retry.retryAction).toBe("unban");
    expect(guild.bans.create).not.toHaveBeenCalled();
    expect((await run(guild, repo, { action: "unban", eventId: post })).status).toBe("executed");
    expect(guild.bans.remove).toHaveBeenCalledTimes(1);
  });

  test("…but never when a ban was taken since the post", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const post = postedAgo(60_000);
    seedModKey(repo, `softban:${post}`, 30_000, "bot");
    seedModKey(repo, "ban", 10_000);
    const retry = await run(guild, repo, { action: "softban", eventId: post });
    expect(retry.status).toBe("duplicate");
    expect(retry.retryAction).toBeUndefined();
  });
});
