import { describe, expect, mock, test } from "bun:test";
import { executeBanAction } from "../../../../src/utils/baitChannel/banExecutor";

/**
 * Minimal fake `Repository<IdempotencyKey>` for the executor's claim path.
 * Keeps a Map of (guildId, userId, action, dayBucket) → row to simulate
 * the UNIQUE index. save() that collides throws like TypeORM would.
 */
function makeIdempotencyRepo() {
  const rows = new Map<string, unknown>();
  const key = (r: {
    guildId: string;
    userId: string;
    action: string;
    dayBucket: Date;
  }) =>
    `${r.guildId}|${r.userId}|${r.action}|${r.dayBucket.toISOString().slice(0, 10)}`;
  return {
    rows,
    create: (entity: unknown) => entity,
    save: mock(async (entity: unknown) => {
      const k = key(entity as never);
      if (rows.has(k)) throw new Error("UNIQUE constraint failed (test fake)");
      rows.set(k, entity);
      return entity;
    }),
    findOne: mock(async ({ where }: { where: Record<string, unknown> }) => {
      const w = where as {
        guildId: string;
        userId: string;
        action: string;
        dayBucket: Date;
      };
      return rows.get(key(w)) ?? null;
    }),
    // Make `as any` casts happy without changing call surface.
  } as never;
}

function makeFakeGuild(id = "g1") {
  return {
    id,
    bans: {
      create: mock(async () => undefined),
      remove: mock(async () => undefined),
    },
  } as never;
}

describe("executeBanAction", () => {
  test("ban path calls guild.bans.create via REST and returns executed", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await executeBanAction(
      {
        guild,
        userId: "u1",
        action: "ban",
        reason: "cogworks:bait score=90",
        executorId: "bot",
        deleteMessageSeconds: 24 * 3600,
      },
      repo,
    );
    expect(result.status).toBe("executed");
    expect(result.action).toBe("ban");
    expect(
      (guild as never as { bans: { create: ReturnType<typeof mock> } }).bans
        .create,
    ).toHaveBeenCalledTimes(1);
  });

  test("idempotency: second call with same key returns duplicate without calling Discord", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    await executeBanAction(
      { guild, userId: "u1", action: "ban", reason: "r" },
      repo,
    );
    const second = await executeBanAction(
      { guild, userId: "u1", action: "ban", reason: "r" },
      repo,
    );
    expect(second.status).toBe("duplicate");
    expect(
      (guild as never as { bans: { create: ReturnType<typeof mock> } }).bans
        .create,
    ).toHaveBeenCalledTimes(1);
  });

  test("softban: ban then unban", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await executeBanAction(
      {
        guild,
        userId: "u1",
        action: "softban",
        reason: "softban test",
        deleteMessageSeconds: 3600,
        softbanDelayMs: 0,
      },
      repo,
    );
    expect(result.status).toBe("executed");
    const bans = (
      guild as never as {
        bans: {
          create: ReturnType<typeof mock>;
          remove: ReturnType<typeof mock>;
        };
      }
    ).bans;
    expect(bans.create).toHaveBeenCalledTimes(1);
    expect(bans.remove).toHaveBeenCalledTimes(1);
  });

  test("log-only: claims the key but does not call Discord", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await executeBanAction(
      { guild, userId: "u1", action: "log-only", reason: "r" },
      repo,
    );
    expect(result.status).toBe("executed");
    const bans = (
      guild as never as { bans: { create: ReturnType<typeof mock> } }
    ).bans;
    expect(bans.create).not.toHaveBeenCalled();
  });

  test("test mode: claims the key but skips Discord", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await executeBanAction(
      { guild, userId: "u1", action: "ban", reason: "r", testMode: true },
      repo,
    );
    expect(result.status).toBe("executed");
    const bans = (
      guild as never as { bans: { create: ReturnType<typeof mock> } }
    ).bans;
    expect(bans.create).not.toHaveBeenCalled();
  });

  test("timeout without member ref → failed (no API call)", async () => {
    const repo = makeIdempotencyRepo();
    const guild = makeFakeGuild();
    const result = await executeBanAction(
      {
        guild,
        userId: "u1",
        action: "timeout",
        reason: "r",
        timeoutMs: 60_000,
      },
      repo,
    );
    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("GuildMember ref");
  });
});
