/**
 * Close Workflow Behavioral Tests
 *
 * Exercises archiveAndCloseTicket end-to-end with faked Discord client,
 * channel, and TypeORM repo. Mocks the seam dependencies (lazyRepo,
 * verifiedChannelDelete, fetchMessagesAsTranscript, forumTagManager,
 * legacyTypes) at module-resolution time via Bun's mock.module() so the
 * real transcriptBuilder still runs.
 *
 * Coverage targets the four failure modes the handoff called out plus
 * the happy path variants and re-close behavior:
 *   - First-close happy paths (custom type, legacy type, email ticket)
 *   - Re-close into existing archive thread (with + without new tag)
 *   - Transcript fetch failure (short-circuits before forum write)
 *   - Forum post failure (ticket still closes; archived flag honest)
 *   - Channel delete: success / already-gone / hard failure
 *   - Orphaned customTypeId (resolveTicketType returns null)
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — must run before importing the SUT
// ---------------------------------------------------------------------------

interface FakeRepoState {
  findOneByResult: any;
  saveCalls: any[];
  createCalls: any[];
}

const fakeRepoState: FakeRepoState = {
  findOneByResult: null,
  saveCalls: [],
  createCalls: [],
};

const fakeRepo = {
  findOneBy: jest.fn(async () => fakeRepoState.findOneByResult),
  create: jest.fn((data: any) => {
    fakeRepoState.createCalls.push(data);
    return data;
  }),
  save: jest.fn(async (entity: any) => {
    fakeRepoState.saveCalls.push(entity);
    return entity;
  }),
};

// We don't mock the lazyRepo module — Bun's per-file mock.module can race
// against suite-wide module loading. Instead, AppDataSource.getRepository
// is patched in beforeAll to return our fake. The lazyRepo Proxy delegates
// to it on first property access, so by the time the SUT actually uses
// archivedTicketRepo, the patched getter is in place.

const fakeVerifiedChannelDelete = jest.fn(async () => ({
  success: true,
  alreadyGone: false,
}));
mock.module("../../../../src/utils/discord/verifiedDelete", () => ({
  verifiedChannelDelete: fakeVerifiedChannelDelete,
}));

const fakeFetchMessages = jest.fn(async () => [] as any[]);
mock.module("../../../../src/utils/fetchAllMessages", () => ({
  fetchMessagesAsTranscript: fakeFetchMessages,
}));

const fakeEnsureForumTag = jest.fn(async () => "tag-123");
const fakeApplyForumTags = jest.fn(async () => undefined);
mock.module("../../../../src/utils/forumTagManager", () => ({
  ensureForumTag: fakeEnsureForumTag,
  applyForumTags: fakeApplyForumTags,
}));

const fakeResolveTicketType = jest.fn();
const fakeLegacyTypeInfo = jest.fn();
mock.module("../../../../src/utils/ticket/legacyTypes", () => ({
  resolveTicketType: fakeResolveTicketType,
  legacyTypeInfo: fakeLegacyTypeInfo,
}));

// ---------------------------------------------------------------------------
// SUT — dynamically imported in beforeAll so mock.module() takes effect
// before closeWorkflow.ts captures `lazyRepo(ArchivedTicket)` at module load.
// ---------------------------------------------------------------------------

type ArchiveTicketResult =
  import("../../../../src/utils/ticket/closeWorkflow").ArchiveTicketResult;
let archiveAndCloseTicket: typeof import("../../../../src/utils/ticket/closeWorkflow").archiveAndCloseTicket;

beforeAll(async () => {
  const { AppDataSource } = await import("../../../../src/typeorm");
  // Patch getRepository so lazyRepo's Proxy.get returns our fake.
  (AppDataSource as unknown as { getRepository: () => unknown }).getRepository =
    () => fakeRepo;
  const sut = await import("../../../../src/utils/ticket/closeWorkflow");
  archiveAndCloseTicket = sut.archiveAndCloseTicket;
});

// ---------------------------------------------------------------------------
// Fake-builder helpers
// ---------------------------------------------------------------------------

interface FakeThreadState {
  id: string;
  sentMessages: string[];
}

function makeFakeThread(id = "new-thread-1"): FakeThreadState & { send: any } {
  const state: FakeThreadState = { id, sentMessages: [] };
  return {
    ...state,
    send: jest.fn(async ({ content }: { content: string }) => {
      state.sentMessages.push(content);
      return { id: `${id}-msg-${state.sentMessages.length}` };
    }),
  };
}

interface FakeForumState {
  threadsCreated: any[];
  threadsFetched: Map<string, any>;
  createShouldThrow?: Error;
  fetchShouldThrow?: Error;
}

function makeFakeForumChannel(state: FakeForumState) {
  return {
    threads: {
      create: jest.fn(async ({ name }: { name: string }) => {
        if (state.createShouldThrow) throw state.createShouldThrow;
        const thread = makeFakeThread(`thread-for-${name}`);
        state.threadsCreated.push(thread);
        return thread;
      }),
      fetch: jest.fn(async (id: string) => {
        if (state.fetchShouldThrow) throw state.fetchShouldThrow;
        const existing = state.threadsFetched.get(id);
        if (existing) return existing;
        const thread = makeFakeThread(id);
        state.threadsFetched.set(id, thread);
        return thread;
      }),
    },
  };
}

function makeFakeClient(
  forumChannel: any,
  userResolver: (id: string) => any = () => null,
) {
  return {
    user: { id: "bot-client-id" },
    channels: {
      fetch: jest.fn(async (_id: string) => forumChannel),
    },
    users: {
      fetch: jest.fn(async (id: string) => userResolver(id)),
    },
  } as any;
}

function makeFakeChannel(id = "ticket-channel-1") {
  return {
    id,
    createdAt: new Date("2026-04-20T10:00:00Z"),
  } as any;
}

function makeTicket(overrides: Partial<any> = {}): any {
  return {
    id: 1,
    guildId: "guild-1",
    channelId: "ticket-channel-1",
    messageId: null,
    createdBy: "user-100",
    type: null,
    customTypeId: null,
    isEmailTicket: false,
    emailSender: null,
    emailSenderName: null,
    emailSubject: null,
    assignedTo: null,
    lastActivityAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("archiveAndCloseTicket", () => {
  let forumState: FakeForumState;
  let forumChannel: any;

  beforeEach(() => {
    fakeRepoState.findOneByResult = null;
    fakeRepoState.saveCalls = [];
    fakeRepoState.createCalls = [];
    fakeRepo.findOneBy.mockClear();
    fakeRepo.create.mockClear();
    fakeRepo.save.mockClear();
    fakeVerifiedChannelDelete.mockClear();
    fakeVerifiedChannelDelete.mockImplementation(async () => ({
      success: true,
      alreadyGone: false,
    }));
    fakeFetchMessages.mockClear();
    fakeFetchMessages.mockImplementation(async () => []);
    fakeEnsureForumTag.mockClear();
    fakeEnsureForumTag.mockImplementation(async () => "tag-123");
    fakeApplyForumTags.mockClear();
    fakeApplyForumTags.mockImplementation(async () => undefined);
    fakeResolveTicketType.mockReset();
    fakeLegacyTypeInfo.mockReset();

    forumState = { threadsCreated: [], threadsFetched: new Map() };
    forumChannel = makeFakeForumChannel(forumState);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("happy path — custom type, first close: creates new forum thread + saves archive + deletes channel", async () => {
    fakeResolveTicketType.mockResolvedValue({
      typeId: "support",
      displayName: "Support",
      emoji: "🛠️",
      isLegacy: false,
    });
    const client = makeFakeClient(forumChannel, (id) => ({
      username: `user-${id}`,
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ customTypeId: "support", type: "support" });

    const result: ArchiveTicketResult = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(forumChannel.threads.create).toHaveBeenCalledTimes(1);
    expect(forumState.threadsCreated).toHaveLength(1);
    // Header is the initial create message; transcript chunks (if any) are follow-ups.
    expect(
      forumChannel.threads.create.mock.calls[0][0].message.content,
    ).toContain("Ticket");
    // Forum tag ensured + applied
    expect(fakeEnsureForumTag).toHaveBeenCalledWith(
      forumChannel,
      "support",
      "Support",
      "🛠️",
    );
    expect(fakeApplyForumTags).toHaveBeenCalledTimes(1);
    // Archive row created and saved
    expect(fakeRepoState.createCalls).toHaveLength(1);
    expect(fakeRepoState.createCalls[0]).toMatchObject({
      guildId: "guild-1",
      createdBy: "user-100",
      ticketType: "support",
      customTypeId: "support",
      forumTagIds: ["tag-123"],
      isEmailTicket: false,
    });
    expect(fakeRepoState.saveCalls).toHaveLength(1);
    // Channel deleted
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test("happy path — legacy type, first close: uses legacyTypeInfo for display", async () => {
    fakeLegacyTypeInfo.mockReturnValue({
      typeId: "general",
      displayName: "General Inquiry",
      emoji: "💬",
    });
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ type: "general" });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(fakeResolveTicketType).not.toHaveBeenCalled();
    expect(fakeLegacyTypeInfo).toHaveBeenCalledWith("general");
    expect(fakeEnsureForumTag).toHaveBeenCalledWith(
      forumChannel,
      "general",
      "General Inquiry",
      "💬",
    );
    expect(fakeRepoState.createCalls[0]).toMatchObject({
      ticketType: "general",
    });
  });

  test("happy path — email ticket, first close: uses emailSender + emailSenderName + emailSubject", async () => {
    fakeLegacyTypeInfo.mockReturnValue(null);
    const client = makeFakeClient(forumChannel, () => null);
    const channel = makeFakeChannel();
    const ticket = makeTicket({
      isEmailTicket: true,
      emailSender: "alice@example.com",
      emailSenderName: "Alice",
      emailSubject: "Help needed with X",
    });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    // Email ticket lookup uses emailSender, not createdBy
    expect(fakeRepo.findOneBy).toHaveBeenCalledWith({
      emailSender: "alice@example.com",
      guildId: "guild-1",
    });
    expect(fakeRepoState.createCalls[0]).toMatchObject({
      isEmailTicket: true,
      emailSender: "alice@example.com",
      emailSenderName: "Alice",
      emailSubject: "Help needed with X",
    });
  });

  test("re-close into existing archive: appends separator + posts to existing thread", async () => {
    fakeLegacyTypeInfo.mockReturnValue({
      typeId: "general",
      displayName: "General",
      emoji: null,
    });
    fakeRepoState.findOneByResult = {
      messageId: "existing-thread-9",
      forumTagIds: ["tag-123"],
    };
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ type: "general" });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    // No NEW thread created — existing one fetched
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(forumChannel.threads.fetch).toHaveBeenCalledWith(
      "existing-thread-9",
    );
    const existingThread = forumState.threadsFetched.get("existing-thread-9");
    expect(existingThread.sentMessages.length).toBeGreaterThan(0);
    // First sent message starts with the separator
    expect(existingThread.sentMessages[0]).toContain("━━━");
    // Tag already in existing array — no extra applyForumTags or save
    expect(fakeApplyForumTags).not.toHaveBeenCalled();
    expect(fakeRepoState.saveCalls).toHaveLength(0);
  });

  test("re-close: new tag accumulates and saves the existing archive row", async () => {
    fakeLegacyTypeInfo.mockReturnValue({
      typeId: "bug",
      displayName: "Bug Report",
      emoji: "🐛",
    });
    fakeEnsureForumTag.mockResolvedValue("tag-bug");
    fakeRepoState.findOneByResult = {
      messageId: "existing-thread-9",
      forumTagIds: ["tag-old-support"],
    };
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ type: "bug" });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(fakeApplyForumTags).toHaveBeenCalledTimes(1);
    expect(fakeApplyForumTags).toHaveBeenCalledWith(
      forumChannel,
      "existing-thread-9",
      ["tag-old-support", "tag-bug"],
    );
    // Existing archive row saved with merged tags
    expect(fakeRepoState.saveCalls).toHaveLength(1);
    expect(fakeRepoState.saveCalls[0].forumTagIds).toEqual([
      "tag-old-support",
      "tag-bug",
    ]);
  });

  test("transcript fetch failure: short-circuits before any forum write or channel delete", async () => {
    fakeFetchMessages.mockRejectedValue(new Error("Discord API timeout"));
    const client = makeFakeClient(forumChannel);
    const channel = makeFakeChannel();
    const ticket = makeTicket();

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({
      success: false,
      archived: false,
      transcriptFailed: true,
      error: "Transcript fetch failed",
    });
    // Critical: no forum side effects, no channel delete
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(forumChannel.threads.fetch).not.toHaveBeenCalled();
    expect(fakeRepoState.createCalls).toHaveLength(0);
    expect(fakeVerifiedChannelDelete).not.toHaveBeenCalled();
  });

  test("forum post failure: ticket still closes (archived: false but success: true)", async () => {
    fakeLegacyTypeInfo.mockReturnValue({
      typeId: "general",
      displayName: "General",
      emoji: null,
    });
    forumState.createShouldThrow = new Error(
      "Discord 50013 — missing permissions on forum",
    );
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ type: "general" });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    // Honest archived flag (the v3.1.9 contract-fidelity fix)
    expect(result).toEqual({ success: true, archived: false });
    // Channel still deleted despite archive failure
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
    // No archive row saved (creation never reached the save call)
    expect(fakeRepoState.saveCalls).toHaveLength(0);
  });

  test("channel delete: already-gone counts as success (Discord 10003)", async () => {
    fakeLegacyTypeInfo.mockReturnValue({
      typeId: "general",
      displayName: "General",
      emoji: null,
    });
    fakeVerifiedChannelDelete.mockResolvedValue({
      success: true,
      alreadyGone: true,
    });
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ type: "general" });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test("channel delete: hard failure logged but workflow still returns success: true", async () => {
    fakeLegacyTypeInfo.mockReturnValue({
      typeId: "general",
      displayName: "General",
      emoji: null,
    });
    fakeVerifiedChannelDelete.mockResolvedValue({
      success: false,
      alreadyGone: false,
      error: "Discord 50013 — missing permissions",
    });
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ type: "general" });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    // Workflow returns success: true regardless — channel delete failure is logged,
    // not propagated. The archive succeeded; the orphaned channel is a Discord-side
    // problem. This documents current behavior; bumping it to success: false would
    // be a separate behavior-change patch.
    expect(result).toEqual({ success: true, archived: true });
  });

  test("orphaned customTypeId (resolveTicketType returns null): falls back to default title", async () => {
    fakeResolveTicketType.mockResolvedValue(null);
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({
      customTypeId: "deleted-type-id",
      type: "support",
    });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(fakeResolveTicketType).toHaveBeenCalledWith(
      "guild-1",
      "deleted-type-id",
    );
    // Without resolved type info, no tag is ensured
    expect(fakeEnsureForumTag).not.toHaveBeenCalled();
    // Archive row still created with the (raw) ticket.type value
    expect(fakeRepoState.createCalls[0]).toMatchObject({
      ticketType: "support",
      customTypeId: "deleted-type-id",
    });
  });

  test("customTypeId resolved as legacy: returns null (matches isLegacy guard) so no tag ensured", async () => {
    fakeResolveTicketType.mockResolvedValue({
      typeId: "general",
      displayName: "General",
      emoji: null,
      isLegacy: true,
    });
    const client = makeFakeClient(forumChannel, () => ({
      username: "creator",
    }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({ customTypeId: "general", type: "general" });

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
    );

    expect(result).toEqual({ success: true, archived: true });
    // Legacy fallback intentionally returns null — no tag ensured
    expect(fakeEnsureForumTag).not.toHaveBeenCalled();
    // legacyTypeInfo NOT consulted because customTypeId branch already returned null
    expect(fakeLegacyTypeInfo).not.toHaveBeenCalled();
  });
});
