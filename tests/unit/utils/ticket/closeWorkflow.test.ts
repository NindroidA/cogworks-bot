/**
 * Close Workflow Behavioral Tests
 *
 * Exercises archiveAndCloseTicket end-to-end with faked Discord client,
 * channel, and TypeORM repo. The seam dependencies (verifiedChannelDelete,
 * fetchMessagesAsTranscript, forumTagManager, builtinTypes/resolveTicketType)
 * are INJECTED via the function's `deps` argument — not mock.module() — so the
 * real transcriptBuilder still runs and import order can't affect binding. The
 * repository seam is the one exception: it stays on the AppDataSource
 * .getRepository runtime patch (lazyRepo resolves it lazily at call-time).
 *
 * Coverage targets the four failure modes the handoff called out plus
 * the happy path variants and re-close behavior:
 *   - First-close happy paths (custom type, builtin type, email ticket)
 *   - Re-close into existing archive thread (with + without new tag)
 *   - Transcript fetch failure (short-circuits before forum write)
 *   - Forum post failure (ticket still closes; archived flag honest)
 *   - Channel delete: success / already-gone / hard failure
 *   - Orphaned customTypeId (resolveTicketType returns null)
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "bun:test";
// SUT imported statically: ALL deps (incl. the repo) are injected via the
// `deps` argument below, so there is no mock.module() and no getRepository
// patch — import order and cross-file module state are irrelevant.
import {
  archiveAndCloseTicket,
  type ArchiveTicketResult,
  type CloseWorkflowDeps,
} from "../../../../src/utils/ticket/closeWorkflow";

// ---------------------------------------------------------------------------
// Fakes — injected into the SUT via `deps` (built below), except the repo
// which is bound through the AppDataSource.getRepository patch in beforeAll.
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

const fakeFetchMessages = jest.fn(async () => [] as any[]);

const fakeEnsureForumTag = jest.fn(async () => "tag-123");
const fakeApplyForumTags = jest.fn(async () => undefined);

const fakeResolveTicketType = jest.fn();
// Default implementation = real `builtinTypeInfo` shape so other test files
// that import this mocked module (e.g. builtinTypes.test.ts via Bun's
// process-shared module mock cache) still get correct lookups. Per-test
// overrides via `mockReturnValue` work as before; the `beforeEach` below
// restores the default after each test's reset.
const fakeBuiltinTypeInfo = jest
  .fn()
  .mockImplementation((id: string) =>
    (BUILTIN_TICKET_TYPE_IDS as readonly string[]).includes(id)
      ? BUILTIN_TYPE_BY_ID[id]
      : null,
  );
// Re-export the real BUILTIN_* tables alongside the fakes so other test
// files (e.g. builtinTypes.test.ts) that import this module still see the
// real data. mock.module() is process-global once installed, so leaving
// out exports here makes them `undefined` everywhere.
const BUILTIN_TICKET_TYPE_IDS = [
  "18_verify",
  "ban_appeal",
  "player_report",
  "bug_report",
  "other",
] as const;
const BUILTIN_TYPES = [
  { typeId: "18_verify", displayName: "18+ Verification", emoji: "🔞" },
  { typeId: "ban_appeal", displayName: "Ban Appeal", emoji: "⚖️" },
  { typeId: "player_report", displayName: "Player Report", emoji: "📢" },
  { typeId: "bug_report", displayName: "Bug Report", emoji: "🐛" },
  { typeId: "other", displayName: "Other", emoji: "❓" },
];
const BUILTIN_TYPE_BY_ID = Object.fromEntries(
  BUILTIN_TYPES.map((t) => [t.typeId, t]),
);
const realIsBuiltinTicketType = (id: string) =>
  (BUILTIN_TICKET_TYPE_IDS as readonly string[]).includes(id);

// EVERY seam dependency is INJECTED directly via archiveAndCloseTicket's `deps`
// parameter — including the archived-ticket repo. We deliberately use neither
// mock.module() nor a shared AppDataSource.getRepository monkey-patch: bun
// applies both inconsistently across a full-suite run on Linux (mock.module
// could leave the SUT bound to the real forum/transcript functions, and the
// shared getRepository patch could be stomped by a sibling test file), so the
// SUT's repo threw and the archive catch silently set archived:false (flaky CI
// 2026-05-30 — green on macOS + on the PR check, failed on the push to main).
// Passing every dependency through the function argument is the only fully
// deterministic, zero-shared-global-state approach, identical on every platform.
const deps = {
  fetchMessagesAsTranscript: fakeFetchMessages,
  ensureForumTag: fakeEnsureForumTag,
  applyForumTags: fakeApplyForumTags,
  verifiedChannelDelete: fakeVerifiedChannelDelete,
  resolveTicketType: fakeResolveTicketType,
  builtinTypeInfo: fakeBuiltinTypeInfo,
  archivedTicketRepo: fakeRepo,
} as unknown as CloseWorkflowDeps;

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
    fakeBuiltinTypeInfo.mockReset();
    // Restore the real-impl default so cross-suite imports get correct
    // lookups when no per-test override is in play. Per-test overrides
    // via `.mockReturnValue(...)` still take precedence.
    fakeBuiltinTypeInfo.mockImplementation((id: string) =>
      realIsBuiltinTicketType(id) ? BUILTIN_TYPE_BY_ID[id] : null,
    );

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
      isBuiltin: false,
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
      deps,
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

  test("happy path — builtin type, first close: uses builtinTypeInfo for display", async () => {
    fakeBuiltinTypeInfo.mockReturnValue({
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
      deps,
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(fakeResolveTicketType).not.toHaveBeenCalled();
    expect(fakeBuiltinTypeInfo).toHaveBeenCalledWith("general");
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
    fakeBuiltinTypeInfo.mockReturnValue(null);
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
      deps,
    );

    expect(result).toEqual({ success: true, archived: true });
    // Email ticket lookup is scoped to the EMAIL archive namespace
    // (isEmailTicket:true + emailSender) — never the createdBy namespace.
    expect(fakeRepo.findOneBy).toHaveBeenCalledWith({
      guildId: "guild-1",
      isEmailTicket: true,
      emailSender: "alice@example.com",
    });
    expect(fakeRepoState.createCalls[0]).toMatchObject({
      isEmailTicket: true,
      emailSender: "alice@example.com",
      emailSenderName: "Alice",
      emailSubject: "Help needed with X",
    });
  });

  test("regression: a normal ticket queries the createdBy namespace with isEmailTicket:false (never an email-import archive)", async () => {
    // The reported prod bug: an email-import archive's createdBy is the
    // importing admin. A normal ticket the admin opens must NOT match it —
    // the lookup is scoped to isEmailTicket:false so the two archive
    // namespaces can never cross-contaminate.
    fakeBuiltinTypeInfo.mockReturnValue({
      typeId: "general",
      displayName: "General",
      emoji: null,
    });
    const client = makeFakeClient(forumChannel, () => ({ username: "admin" }));
    const channel = makeFakeChannel();
    const ticket = makeTicket({
      type: "general",
      createdBy: "admin-id",
      isEmailTicket: false,
    });

    await archiveAndCloseTicket(
      client,
      ticket,
      "guild-1",
      channel,
      "forum-archive-1",
      deps,
    );

    expect(fakeRepo.findOneBy).toHaveBeenCalledWith({
      guildId: "guild-1",
      isEmailTicket: false,
      createdBy: "admin-id",
    });
  });

  test("re-close into existing archive: appends separator + posts to existing thread", async () => {
    fakeBuiltinTypeInfo.mockReturnValue({
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
      deps,
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
    fakeBuiltinTypeInfo.mockReturnValue({
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
      deps,
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
      deps,
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
    fakeBuiltinTypeInfo.mockReturnValue({
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
      deps,
    );

    // Honest archived flag (the v3.1.9 contract-fidelity fix)
    expect(result).toEqual({ success: true, archived: false });
    // Channel still deleted despite archive failure
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
    // No archive row saved (creation never reached the save call)
    expect(fakeRepoState.saveCalls).toHaveLength(0);
  });

  test("channel delete: already-gone counts as success (Discord 10003)", async () => {
    fakeBuiltinTypeInfo.mockReturnValue({
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
      deps,
    );

    expect(result).toEqual({ success: true, archived: true });
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test("channel delete: hard failure logged but workflow still returns success: true", async () => {
    fakeBuiltinTypeInfo.mockReturnValue({
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
      deps,
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
      deps,
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

  test("customTypeId resolved as builtin: returns null (matches isBuiltin guard) so no tag ensured", async () => {
    fakeResolveTicketType.mockResolvedValue({
      typeId: "general",
      displayName: "General",
      emoji: null,
      isBuiltin: true,
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
      deps,
    );

    expect(result).toEqual({ success: true, archived: true });
    // Builtin fallback intentionally returns null — no tag ensured
    expect(fakeEnsureForumTag).not.toHaveBeenCalled();
    // builtinTypeInfo NOT consulted because customTypeId branch already returned null
    expect(fakeBuiltinTypeInfo).not.toHaveBeenCalled();
  });
});
