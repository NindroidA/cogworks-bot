/**
 * ticketHandlers API Behavioral Tests
 *
 * Exercises the POST /tickets/:id/close route registered by
 * registerTicketHandlers. Uses the AppDataSource.getRepository runtime
 * patch (per closeWorkflow.test.ts lessons — Bun's per-file mock.module
 * races against suite-wide module loading; runtime patching avoids that)
 * plus mock.module for archiveAndCloseTicket and writeAuditLog.
 *
 * Coverage:
 *   - Happy path: ticket closed, archive succeeds, audit log written
 *   - 404 when ticket not found (guild-scoped lookup)
 *   - 409 conflict when ticket already closed
 *   - 404 when archive config missing
 *   - Channel-not-found path: marks closed, returns archived: false (no archive call)
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import type { Client } from "discord.js";

// ---------------------------------------------------------------------------
// Mocks for non-repo deps
// ---------------------------------------------------------------------------

// Injected into registerTicketHandlers (3rd arg) — NOT mock.module'd. Mocking
// the shared ticket/closeWorkflow module here would leak process-globally and
// make closeWorkflow's own test suite import this fake instead of the real SUT
// (bun's mock.module is process-shared and not undone by mock.restore).
const fakeArchiveAndClose = jest.fn(async () => ({
  success: true,
  archived: true,
}));

const fakeWriteAuditLog = jest.fn(async () => undefined);
mock.module("../../../../src/utils/api/handlers/auditHelper", () => ({
  writeAuditLog: fakeWriteAuditLog,
}));

// ---------------------------------------------------------------------------
// Per-entity fake repos, indexed by entity reference
// ---------------------------------------------------------------------------

interface RepoState {
  findOneByResult: any;
  updateCalls: any[];
}

const ticketRepoState: RepoState = { findOneByResult: null, updateCalls: [] };
const archivedTicketConfigRepoState: RepoState = {
  findOneByResult: null,
  updateCalls: [],
};

function makeFakeRepo(state: RepoState) {
  return {
    findOneBy: jest.fn(async () => state.findOneByResult),
    update: jest.fn(async (criteria: any, partial: any) => {
      state.updateCalls.push({ criteria, partial });
      return { affected: 1 };
    }),
  };
}

const ticketRepo = makeFakeRepo(ticketRepoState);
const archivedConfigRepo = makeFakeRepo(archivedTicketConfigRepoState);

let registerTicketHandlers: typeof import("../../../../src/utils/api/handlers/ticketHandlers").registerTicketHandlers;
let routes: Map<string, any>;
let fakeClient: Client;
let fakeChannel: any;
let fakeAssignChannel: any;
let originalGetRepository: ((entity: unknown) => unknown) | undefined;

beforeAll(async () => {
  // Map each entity import to its corresponding fake repo.
  const { AppDataSource } = await import("../../../../src/typeorm");
  const { Ticket } = await import(
    "../../../../src/typeorm/entities/ticket/Ticket"
  );
  const { ArchivedTicketConfig } = await import(
    "../../../../src/typeorm/entities/ticket/ArchivedTicketConfig"
  );
  const repoMap = new Map<unknown, unknown>([
    [Ticket, ticketRepo],
    [ArchivedTicketConfig, archivedConfigRepo],
  ]);
  // Capture so afterAll can restore. Bun shares module state across test files.
  originalGetRepository = (
    AppDataSource as unknown as { getRepository: (e: unknown) => unknown }
  ).getRepository;
  (
    AppDataSource as unknown as { getRepository: (e: unknown) => unknown }
  ).getRepository = (entity) =>
    repoMap.get(entity) ??
    (() => {
      throw new Error(`Unmocked entity: ${(entity as { name?: string }).name}`);
    })();
  const sut = await import("../../../../src/utils/api/handlers/ticketHandlers");
  registerTicketHandlers = sut.registerTicketHandlers;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import("../../../../src/typeorm");
    (
      AppDataSource as unknown as { getRepository: (e: unknown) => unknown }
    ).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  ticketRepoState.findOneByResult = null;
  ticketRepoState.updateCalls = [];
  archivedTicketConfigRepoState.findOneByResult = null;
  archivedTicketConfigRepoState.updateCalls = [];
  ticketRepo.findOneBy.mockClear();
  ticketRepo.update.mockClear();
  archivedConfigRepo.findOneBy.mockClear();
  archivedConfigRepo.update.mockClear();
  fakeArchiveAndClose.mockClear();
  fakeArchiveAndClose.mockImplementation(async () => ({
    success: true,
    archived: true,
  }));
  fakeWriteAuditLog.mockClear();

  fakeChannel = { id: "ticket-channel-1", isTextBased: () => true };
  fakeAssignChannel = {
    id: "ticket-channel-1",
    permissionOverwrites: { create: jest.fn(async () => undefined) },
  };
  const fakeGuild = {
    channels: { fetch: jest.fn(async () => fakeAssignChannel) },
  };
  fakeClient = {
    channels: {
      fetch: jest.fn(async () => fakeChannel),
    },
    guilds: {
      cache: { get: jest.fn(() => fakeGuild) },
    },
  } as any;

  routes = new Map();
  registerTicketHandlers(fakeClient, routes, fakeArchiveAndClose);
});

afterEach(() => {
  jest.clearAllMocks();
});

function getCloseHandler() {
  const handler = routes.get("POST /tickets/:id/close");
  if (!handler) throw new Error("POST /tickets/:id/close not registered");
  return handler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /tickets/:id/close", () => {
  test("happy path: marks closed, calls archiveAndCloseTicket, writes audit log", async () => {
    ticketRepoState.findOneByResult = {
      id: 42,
      guildId: "guild-1",
      status: "open",
      channelId: "ticket-channel-1",
    };
    archivedTicketConfigRepoState.findOneByResult = {
      guildId: "guild-1",
      channelId: "archive-forum-1",
    };

    const result = await getCloseHandler()(
      "guild-1",
      { triggeredBy: "user-99" },
      "/tickets/42/close",
    );

    expect(result).toEqual({ success: true, ticketId: 42, archived: true });
    // Guild-scoped lookup
    expect(ticketRepo.findOneBy).toHaveBeenCalledWith({
      guildId: "guild-1",
      id: 42,
    });
    // Status flip happens BEFORE the archive call
    expect(ticketRepoState.updateCalls[0]).toEqual({
      criteria: { id: 42, guildId: "guild-1" },
      partial: { status: "closed" },
    });
    // Archive helper called with the right channel + archive config
    expect(fakeArchiveAndClose).toHaveBeenCalledTimes(1);
    expect(fakeArchiveAndClose.mock.calls[0][2]).toBe("guild-1");
    expect(fakeArchiveAndClose.mock.calls[0][4]).toBe("archive-forum-1");
    // Audit log includes triggeredBy
    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "ticket.close",
      "user-99",
      { ticketId: 42 },
    );
  });

  test("returns 404 when ticket not found", async () => {
    ticketRepoState.findOneByResult = null;

    await expect(
      getCloseHandler()("guild-1", {}, "/tickets/42/close"),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Ticket not found",
    });
    expect(ticketRepoState.updateCalls).toHaveLength(0);
    expect(fakeArchiveAndClose).not.toHaveBeenCalled();
  });

  test("returns 409 when ticket is already closed", async () => {
    ticketRepoState.findOneByResult = {
      id: 42,
      guildId: "guild-1",
      status: "closed",
      channelId: "ticket-channel-1",
    };

    await expect(
      getCloseHandler()("guild-1", {}, "/tickets/42/close"),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Ticket already closed",
    });
    expect(ticketRepoState.updateCalls).toHaveLength(0);
    expect(fakeArchiveAndClose).not.toHaveBeenCalled();
  });

  test("returns 404 when archive config missing — no status flip, no archive call", async () => {
    ticketRepoState.findOneByResult = {
      id: 42,
      guildId: "guild-1",
      status: "open",
      channelId: "ticket-channel-1",
    };
    archivedTicketConfigRepoState.findOneByResult = null;

    await expect(
      getCloseHandler()("guild-1", {}, "/tickets/42/close"),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Archive config not found",
    });
    expect(ticketRepoState.updateCalls).toHaveLength(0);
    expect(fakeArchiveAndClose).not.toHaveBeenCalled();
  });

  test("channel fetch fails: marks closed, returns archived: false, skips archive call", async () => {
    ticketRepoState.findOneByResult = {
      id: 42,
      guildId: "guild-1",
      status: "open",
      channelId: "ticket-channel-1",
    };
    archivedTicketConfigRepoState.findOneByResult = {
      guildId: "guild-1",
      channelId: "archive-forum-1",
    };
    (fakeClient.channels.fetch as any).mockResolvedValue(null);

    const result = await getCloseHandler()("guild-1", {}, "/tickets/42/close");

    expect(result).toEqual({ success: true, ticketId: 42, archived: false });
    // Status was still flipped to closed before the channel-not-found branch returned
    expect(ticketRepoState.updateCalls[0].partial).toEqual({
      status: "closed",
    });
    expect(fakeArchiveAndClose).not.toHaveBeenCalled();
    // Audit log NOT written on the channel-not-found early return (matches current handler behavior)
    expect(fakeWriteAuditLog).not.toHaveBeenCalled();
  });

  test("archiveAndCloseTicket returns archived: false — reverts status for retry, writes NO audit log", async () => {
    ticketRepoState.findOneByResult = {
      id: 42,
      guildId: "guild-1",
      status: "open",
      channelId: "ticket-channel-1",
    };
    archivedTicketConfigRepoState.findOneByResult = {
      guildId: "guild-1",
      channelId: "archive-forum-1",
    };
    fakeArchiveAndClose.mockResolvedValue({ success: false, archived: false });

    const result = await getCloseHandler()("guild-1", {}, "/tickets/42/close");

    // Honest failure surfaced to the caller.
    expect(result).toEqual({ success: false, ticketId: 42, archived: false });
    // Status flipped to closed, then reverted to its prior value so the close
    // can be retried (the workflow preserved the channel).
    expect(ticketRepoState.updateCalls[0].partial).toEqual({
      status: "closed",
    });
    expect(ticketRepoState.updateCalls[1].partial).toEqual({ status: "open" });
    // A failed close is not an audit-worthy "ticket.close".
    expect(fakeWriteAuditLog).not.toHaveBeenCalled();
  });
});

describe("POST /tickets/:id/assign", () => {
  const ASSIGNEE = "123456789012345678";

  function getAssignHandler() {
    const handler = routes.get("POST /tickets/:id/assign");
    if (!handler) throw new Error("POST /tickets/:id/assign not registered");
    return handler;
  }

  test("persists assignedTo + assignedAt (the v3.2.1 bug fix), grants channel access, audits", async () => {
    ticketRepoState.findOneByResult = {
      id: 42,
      guildId: "guild-1",
      status: "open",
      channelId: "ticket-channel-1",
    };

    const result = await getAssignHandler()(
      "guild-1",
      { userId: ASSIGNEE, triggeredBy: "admin-1" },
      "/tickets/42/assign",
    );

    expect(result).toEqual({ success: true });
    // THE FIX: the assignment is now written to the DB (was only a perm overwrite before).
    expect(ticketRepoState.updateCalls).toHaveLength(1);
    const { criteria, partial } = ticketRepoState.updateCalls[0];
    expect(criteria).toEqual({ id: 42, guildId: "guild-1" });
    expect(partial.assignedTo).toBe(ASSIGNEE);
    expect(partial.assignedAt).toBeInstanceOf(Date);
    // Channel access still granted.
    expect(fakeAssignChannel.permissionOverwrites.create).toHaveBeenCalledWith(
      ASSIGNEE,
      expect.objectContaining({ ViewChannel: true, SendMessages: true }),
    );
    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "ticket.assign",
      "admin-1",
      {
        ticketId: 42,
        userId: ASSIGNEE,
      },
    );
  });

  test("rejects a non-snowflake userId before any write", async () => {
    ticketRepoState.findOneByResult = {
      id: 42,
      guildId: "guild-1",
      status: "open",
      channelId: "ticket-channel-1",
    };

    await expect(
      getAssignHandler()(
        "guild-1",
        { userId: "not-a-snowflake" },
        "/tickets/42/assign",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(ticketRepoState.updateCalls).toHaveLength(0);
  });

  test("404 when the ticket does not exist", async () => {
    ticketRepoState.findOneByResult = null;
    await expect(
      getAssignHandler()("guild-1", { userId: ASSIGNEE }, "/tickets/42/assign"),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(ticketRepoState.updateCalls).toHaveLength(0);
  });
});
