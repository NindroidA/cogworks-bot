/**
 * applicationHandlers API Behavioral Tests
 *
 * Exercises the three POST /applications/:id/{approve,deny,archive} routes
 * registered by registerApplicationHandlers. Same mocking strategy as
 * ticketHandlers.test.ts: AppDataSource.getRepository runtime patch + mock.module
 * for archiveAndCloseApplication and writeAuditLog.
 *
 * Coverage:
 *   - approve: happy path, 404 not found, 409 already closed, channel-not-text-based skips message
 *   - deny: happy path includes reason in message
 *   - archive: happy path returns honest archived flag, 404 when archive config missing
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

// Injected into registerApplicationHandlers (3rd arg) — NOT mock.module'd.
// Mocking the shared application/closeWorkflow module here would leak
// process-globally and make closeWorkflow's own test suite import this fake
// instead of the real SUT (bun's mock.module is process-shared and not undone
// by mock.restore). The handler accepts the archive fn as a parameter for
// exactly this reason — mirrors registerTicketHandlers.
const fakeArchiveAndCloseApp = jest.fn(async () => ({
  success: true,
  archived: true,
}));

const fakeWriteAuditLog = jest.fn(async () => undefined);
mock.module("../../../../src/utils/api/handlers/auditHelper", () => ({
  writeAuditLog: fakeWriteAuditLog,
}));

interface RepoState {
  findOneByResult: any;
  updateCalls: any[];
}

const applicationRepoState: RepoState = {
  findOneByResult: null,
  updateCalls: [],
};
const archivedAppConfigRepoState: RepoState = {
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

const applicationRepo = makeFakeRepo(applicationRepoState);
const archivedAppConfigRepo = makeFakeRepo(archivedAppConfigRepoState);

let registerApplicationHandlers: typeof import("../../../../src/utils/api/handlers/applicationHandlers").registerApplicationHandlers;
let routes: Map<string, any>;
let fakeClient: Client;
let fakeChannelSend: any;
let originalGetRepository: ((entity: unknown) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import("../../../../src/typeorm");
  const { Application } = await import(
    "../../../../src/typeorm/entities/application/Application"
  );
  const { ArchivedApplicationConfig } = await import(
    "../../../../src/typeorm/entities/application/ArchivedApplicationConfig"
  );
  const repoMap = new Map<unknown, unknown>([
    [Application, applicationRepo],
    [ArchivedApplicationConfig, archivedAppConfigRepo],
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
  const sut = await import(
    "../../../../src/utils/api/handlers/applicationHandlers"
  );
  registerApplicationHandlers = sut.registerApplicationHandlers;
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
  applicationRepoState.findOneByResult = null;
  applicationRepoState.updateCalls = [];
  archivedAppConfigRepoState.findOneByResult = null;
  archivedAppConfigRepoState.updateCalls = [];
  applicationRepo.findOneBy.mockClear();
  applicationRepo.update.mockClear();
  archivedAppConfigRepo.findOneBy.mockClear();
  archivedAppConfigRepo.update.mockClear();
  fakeArchiveAndCloseApp.mockClear();
  fakeArchiveAndCloseApp.mockImplementation(async () => ({
    success: true,
    archived: true,
  }));
  fakeWriteAuditLog.mockClear();

  fakeChannelSend = jest.fn(async () => ({ id: "msg-1" }));
  fakeClient = {
    channels: {
      fetch: jest.fn(async () => ({
        id: "app-channel-1",
        isTextBased: () => true,
        send: fakeChannelSend,
      })),
    },
  } as any;

  routes = new Map();
  registerApplicationHandlers(fakeClient, routes, fakeArchiveAndCloseApp);
});

afterEach(() => {
  jest.clearAllMocks();
});

function getRoute(path: string) {
  const handler = routes.get(path);
  if (!handler) throw new Error(`${path} not registered`);
  return handler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /applications/:id/approve", () => {
  test("happy path: status flipped to accepted, approval message sent, audit logged", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "app-channel-1",
    };

    const result = await getRoute("POST /applications/:id/approve")(
      "guild-1",
      { triggeredBy: "reviewer-99", message: "Welcome aboard!" },
      "/applications/7/approve",
    );

    expect(result).toEqual({ success: true, applicationId: 7 });
    expect(applicationRepoState.updateCalls[0]).toEqual({
      criteria: { id: 7, guildId: "guild-1" },
      partial: { status: "accepted" },
    });
    expect(fakeChannelSend).toHaveBeenCalledTimes(1);
    expect(fakeChannelSend.mock.calls[0][0]).toContain("Application Approved");
    expect(fakeChannelSend.mock.calls[0][0]).toContain("reviewer-99");
    expect(fakeChannelSend.mock.calls[0][0]).toContain("Welcome aboard!");
    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "application.approve",
      "reviewer-99",
      { applicationId: 7 },
    );
  });

  test("falls back to body.approvedBy when triggeredBy is absent", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "app-channel-1",
    };

    await getRoute("POST /applications/:id/approve")(
      "guild-1",
      { approvedBy: "fallback-user" },
      "/applications/7/approve",
    );

    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "application.approve",
      "fallback-user",
      { applicationId: 7 },
    );
  });

  test("returns 404 when application not found", async () => {
    applicationRepoState.findOneByResult = null;

    await expect(
      getRoute("POST /applications/:id/approve")(
        "guild-1",
        { triggeredBy: "r-1" },
        "/applications/7/approve",
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Application not found",
    });
    expect(applicationRepoState.updateCalls).toHaveLength(0);
  });

  test("returns 409 when application already closed", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "closed",
      channelId: "app-channel-1",
    };

    await expect(
      getRoute("POST /applications/:id/approve")(
        "guild-1",
        { triggeredBy: "r-1" },
        "/applications/7/approve",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Application already closed",
    });
    expect(applicationRepoState.updateCalls).toHaveLength(0);
  });

  test("skips channel send when channel is not text-based", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "app-channel-1",
    };
    (fakeClient.channels.fetch as any).mockResolvedValue({
      isTextBased: () => false,
    });

    const result = await getRoute("POST /applications/:id/approve")(
      "guild-1",
      { triggeredBy: "r-1" },
      "/applications/7/approve",
    );

    expect(result).toEqual({ success: true, applicationId: 7 });
    expect(fakeChannelSend).not.toHaveBeenCalled();
    // Status still flipped + audit still written
    expect(applicationRepoState.updateCalls).toHaveLength(1);
    expect(fakeWriteAuditLog).toHaveBeenCalledTimes(1);
  });
});

describe("POST /applications/:id/deny", () => {
  test("happy path: status flipped to rejected, deny message includes reason", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "app-channel-1",
    };

    const result = await getRoute("POST /applications/:id/deny")(
      "guild-1",
      { triggeredBy: "reviewer-99", reason: "Not enough experience" },
      "/applications/7/deny",
    );

    expect(result).toEqual({ success: true, applicationId: 7 });
    expect(applicationRepoState.updateCalls[0].partial).toEqual({
      status: "rejected",
    });
    expect(fakeChannelSend).toHaveBeenCalledTimes(1);
    expect(fakeChannelSend.mock.calls[0][0]).toContain("Application Denied");
    expect(fakeChannelSend.mock.calls[0][0]).toContain("Not enough experience");
    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "application.deny",
      "reviewer-99",
      { applicationId: 7 },
    );
  });

  test('omitted reason defaults to "No reason provided."', async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "app-channel-1",
    };

    await getRoute("POST /applications/:id/deny")(
      "guild-1",
      { triggeredBy: "r-1" },
      "/applications/7/deny",
    );

    expect(fakeChannelSend.mock.calls[0][0]).toContain("No reason provided.");
  });
});

describe("POST /applications/:id/archive", () => {
  test("happy path: closes app, calls archiveAndCloseApplication, propagates archived flag", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "app-channel-1",
    };
    archivedAppConfigRepoState.findOneByResult = {
      guildId: "guild-1",
      channelId: "archive-forum-1",
    };

    const result = await getRoute("POST /applications/:id/archive")(
      "guild-1",
      { triggeredBy: "reviewer-99" },
      "/applications/7/archive",
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(applicationRepoState.updateCalls[0].partial).toEqual({
      status: "closed",
    });
    expect(fakeArchiveAndCloseApp).toHaveBeenCalledTimes(1);
    expect(fakeArchiveAndCloseApp.mock.calls[0][4]).toBe("archive-forum-1");
    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "application.archive",
      "reviewer-99",
      { applicationId: 7 },
    );
  });

  test("returns 404 when archive config missing", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "c-1",
    };
    archivedAppConfigRepoState.findOneByResult = null;

    await expect(
      getRoute("POST /applications/:id/archive")(
        "guild-1",
        {},
        "/applications/7/archive",
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Archive config not found",
    });
    expect(fakeArchiveAndCloseApp).not.toHaveBeenCalled();
  });

  test("channel not text-based: marks closed, returns archived: false, skips archive call", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "c-1",
    };
    archivedAppConfigRepoState.findOneByResult = {
      guildId: "guild-1",
      channelId: "archive-forum-1",
    };
    (fakeClient.channels.fetch as any).mockResolvedValue({
      isTextBased: () => false,
    });

    const result = await getRoute("POST /applications/:id/archive")(
      "guild-1",
      {},
      "/applications/7/archive",
    );

    expect(result).toEqual({ success: true, archived: false });
    expect(applicationRepoState.updateCalls[0].partial).toEqual({
      status: "closed",
    });
    expect(fakeArchiveAndCloseApp).not.toHaveBeenCalled();
  });

  test("archiveAndCloseApplication returns archived: false — reverts status for retry, no audit log", async () => {
    applicationRepoState.findOneByResult = {
      id: 7,
      guildId: "guild-1",
      status: "pending",
      channelId: "c-1",
    };
    archivedAppConfigRepoState.findOneByResult = {
      guildId: "guild-1",
      channelId: "archive-forum-1",
    };
    fakeArchiveAndCloseApp.mockResolvedValue({
      success: false,
      archived: false,
    });

    const result = await getRoute("POST /applications/:id/archive")(
      "guild-1",
      { triggeredBy: "r-1" },
      "/applications/7/archive",
    );

    // Honest failure; channel preserved by the workflow.
    expect(result).toEqual({ success: false, archived: false });
    // Status flipped to closed, then reverted to its prior value for retry.
    expect(applicationRepoState.updateCalls[0].partial).toEqual({
      status: "closed",
    });
    expect(applicationRepoState.updateCalls[1].partial).toEqual({
      status: "pending",
    });
    expect(fakeWriteAuditLog).not.toHaveBeenCalled();
  });
});
