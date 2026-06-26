/**
 * Application Close Workflow Behavioral Tests
 *
 * Mirrors the ticket close workflow suite. archiveAndCloseApplication contains
 * its OWN copy of the two data-loss-prevention branches (it is not a delegation
 * to the ticket code), so it needs its own coverage:
 *   - B1: re-close into a DELETED archive thread (Discord 10003) recreates +
 *     repoints the thread; a NON-10003 fetch error bubbles (archive fails).
 *   - B2: on archive failure the source channel is PRESERVED (not deleted) and
 *     the result is {success:false, archived:false}.
 *
 * All seams (fetchMessagesAsTranscript, verifiedChannelDelete, archivedAppRepo)
 * are INJECTED via the function's `deps` argument — no mock.module() — for the
 * same deterministic-on-Linux reasons documented in the ticket suite.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  archiveAndCloseApplication,
  type ArchiveApplicationResult,
  type CloseApplicationWorkflowDeps,
} from "../../../../src/utils/application/closeWorkflow";

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

const fakeVerifiedChannelDelete = jest.fn(async () => ({
  success: true,
  alreadyGone: false,
}));
const fakeFetchMessages = jest.fn(async () => [] as any[]);

const deps = {
  fetchMessagesAsTranscript: fakeFetchMessages,
  verifiedChannelDelete: fakeVerifiedChannelDelete,
  archivedAppRepo: fakeRepo,
} as unknown as CloseApplicationWorkflowDeps;

interface FakeForumState {
  threadsCreated: any[];
  threadsFetched: Map<string, any>;
  createShouldThrow?: Error;
  fetchShouldThrow?: Error;
}

function makeFakeThread(id = "new-thread-1") {
  const state = { id, sentMessages: [] as string[] };
  return {
    ...state,
    send: jest.fn(async ({ content }: { content: string }) => {
      state.sentMessages.push(content);
      return { id: `${id}-msg-${state.sentMessages.length}` };
    }),
  };
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
      fetch: jest.fn(async (id: string, _opts?: unknown) => {
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

function makeFakeClient(forumChannel: any, userResolver: (id: string) => any = () => ({ username: "applicant" })) {
  return {
    user: { id: "bot-client-id" },
    channels: { fetch: jest.fn(async () => forumChannel) },
    users: { fetch: jest.fn(async (id: string) => userResolver(id)) },
  } as any;
}

function makeChannel(id = "app-channel-1") {
  return { id, createdAt: new Date("2026-04-20T10:00:00Z") } as any;
}

function makeApplication(overrides: Partial<any> = {}): any {
  return {
    id: 1,
    guildId: "guild-1",
    channelId: "app-channel-1",
    createdBy: "user-100",
    status: "pending",
    ...overrides,
  };
}

describe("archiveAndCloseApplication", () => {
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
    fakeVerifiedChannelDelete.mockImplementation(async () => ({ success: true, alreadyGone: false }));
    fakeFetchMessages.mockClear();
    fakeFetchMessages.mockImplementation(async () => []);
    forumState = { threadsCreated: [], threadsFetched: new Map() };
    forumChannel = makeFakeForumChannel(forumState);
  });

  afterEach(() => jest.clearAllMocks());

  test("happy path — first close: creates thread, saves archive row, deletes channel", async () => {
    const client = makeFakeClient(forumChannel);
    const result: ArchiveApplicationResult = await archiveAndCloseApplication(
      client,
      makeApplication(),
      "guild-1",
      makeChannel(),
      "forum-archive-1",
      deps,
    );

    expect(result).toEqual({ success: true, archived: true, channelDeleted: true });
    expect(forumChannel.threads.create).toHaveBeenCalledTimes(1);
    expect(fakeRepoState.createCalls).toHaveLength(1);
    expect(fakeRepoState.createCalls[0]).toMatchObject({
      guildId: "guild-1",
      createdBy: "user-100",
      messageId: forumState.threadsCreated[0].id,
    });
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test("re-close append: posts separator into the existing thread, no new thread", async () => {
    fakeRepoState.findOneByResult = { messageId: "existing-app-thread" };
    const client = makeFakeClient(forumChannel);
    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      "guild-1",
      makeChannel(),
      "forum-archive-1",
      deps,
    );

    expect(result).toEqual({ success: true, archived: true, channelDeleted: true });
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(forumChannel.threads.fetch).toHaveBeenCalledWith("existing-app-thread", { force: true });
    const thread = forumState.threadsFetched.get("existing-app-thread");
    expect(thread.sentMessages[0]).toContain("━━━");
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test("B1: re-close into a DELETED thread (10003) recreates it, repoints messageId, deletes channel", async () => {
    fakeRepoState.findOneByResult = { messageId: "deleted-app-thread" };
    forumState.fetchShouldThrow = Object.assign(new Error("Unknown Channel"), { code: 10003 });
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      "guild-1",
      makeChannel(),
      "forum-archive-1",
      deps,
    );

    expect(result).toEqual({ success: true, archived: true, channelDeleted: true });
    expect(forumChannel.threads.create).toHaveBeenCalledTimes(1);
    expect(fakeRepoState.saveCalls).toHaveLength(1);
    expect(fakeRepoState.saveCalls[0].messageId).toBe(forumState.threadsCreated[0].id);
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test("B1: NON-10003 fetch error bubbles — archive fails, no recreate, channel preserved", async () => {
    fakeRepoState.findOneByResult = { messageId: "existing-app-thread" };
    forumState.fetchShouldThrow = Object.assign(new Error("Missing Access"), { code: 50001 });
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      "guild-1",
      makeChannel(),
      "forum-archive-1",
      deps,
    );

    expect(result).toEqual({ success: false, archived: false });
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(fakeVerifiedChannelDelete).not.toHaveBeenCalled();
  });

  test("B2: forum post failure preserves the channel (no data loss)", async () => {
    forumState.createShouldThrow = new Error("Discord 50013 — missing permissions");
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      "guild-1",
      makeChannel(),
      "forum-archive-1",
      deps,
    );

    expect(result).toEqual({ success: false, archived: false });
    expect(fakeVerifiedChannelDelete).not.toHaveBeenCalled();
    expect(fakeRepoState.saveCalls).toHaveLength(0);
  });

  test("transcript fetch failure short-circuits before any forum write or channel delete", async () => {
    fakeFetchMessages.mockRejectedValue(new Error("Discord API timeout"));
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      "guild-1",
      makeChannel(),
      "forum-archive-1",
      deps,
    );

    expect(result).toEqual({ success: false, archived: false, transcriptFailed: true });
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(fakeVerifiedChannelDelete).not.toHaveBeenCalled();
  });
});
