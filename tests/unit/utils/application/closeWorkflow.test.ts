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

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import {
  type ArchiveApplicationResult,
  archiveAndCloseApplication,
  type CloseApplicationWorkflowDeps,
} from '../../../../src/utils/application/closeWorkflow';

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

/** Position lookup seam — findOneBy result set per test (null = orphaned). */
const fakePositionRepo = {
  findOneBy: jest.fn(async () => null as any),
};

// Forum-tag seams. ensureForumTag returns a deterministic id per (typeId);
// applyForumTags echoes the tags it was asked to apply (the real one caps at 5
// and merges live thread tags, but tests drive the cap explicitly when needed).
const fakeEnsureForumTag = jest.fn(async (_forum: any, typeId: string) => `tag-${typeId}`);
const fakeApplyForumTags = jest.fn(async (_forum: any, _threadId: string, tags: string[]) => tags);

const deps = {
  fetchMessagesAsTranscript: fakeFetchMessages,
  verifiedChannelDelete: fakeVerifiedChannelDelete,
  archivedAppRepo: fakeRepo,
  positionRepo: fakePositionRepo,
  ensureForumTag: fakeEnsureForumTag,
  applyForumTags: fakeApplyForumTags,
} as unknown as CloseApplicationWorkflowDeps;

interface FakeForumState {
  threadsCreated: any[];
  threadsFetched: Map<string, any>;
  createShouldThrow?: Error;
  fetchShouldThrow?: Error;
}

function makeFakeThread(id = 'new-thread-1') {
  const state = { id, sentMessages: [] as string[] };
  return {
    ...state,
    send: jest.fn(async ({ content, embeds }: { content?: string; embeds?: any[] }) => {
      // Embed-only sends (header cards) are recorded as a tagged title line so
      // assertions can distinguish them from transcript text chunks.
      state.sentMessages.push(content ?? `[embed] ${embeds?.[0]?.data?.title ?? ''}`);
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

function makeFakeClient(forumChannel: any, userResolver: (id: string) => any = () => ({ username: 'applicant' })) {
  return {
    user: { id: 'bot-client-id' },
    channels: { fetch: jest.fn(async () => forumChannel) },
    users: { fetch: jest.fn(async (id: string) => userResolver(id)) },
  } as any;
}

function makeChannel(id = 'app-channel-1') {
  return { id, createdAt: new Date('2026-04-20T10:00:00Z') } as any;
}

function makeApplication(overrides: Partial<any> = {}): any {
  return {
    id: 1,
    guildId: 'guild-1',
    channelId: 'app-channel-1',
    createdBy: 'user-100',
    status: 'pending',
    ...overrides,
  };
}

describe('archiveAndCloseApplication', () => {
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
    fakePositionRepo.findOneBy.mockClear();
    fakePositionRepo.findOneBy.mockImplementation(async () => null);
    fakeEnsureForumTag.mockClear();
    fakeEnsureForumTag.mockImplementation(async (_forum: any, typeId: string) => `tag-${typeId}`);
    fakeApplyForumTags.mockClear();
    fakeApplyForumTags.mockImplementation(async (_forum: any, _threadId: string, tags: string[]) => tags);
    forumState = { threadsCreated: [], threadsFetched: new Map() };
    forumChannel = makeFakeForumChannel(forumState);
  });

  afterEach(() => jest.clearAllMocks());

  test('happy path — first close: creates thread, saves archive row, deletes channel', async () => {
    const client = makeFakeClient(forumChannel);
    const result: ArchiveApplicationResult = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result).toEqual({ success: true, archived: true, channelDeleted: true });
    expect(forumChannel.threads.create).toHaveBeenCalledTimes(1);
    expect(fakeRepoState.createCalls).toHaveLength(1);
    expect(fakeRepoState.createCalls[0]).toMatchObject({
      guildId: 'guild-1',
      createdBy: 'user-100',
      messageId: forumState.threadsCreated[0].id,
    });
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test('channel delete refused → archived:true but channelDeleted:false (caller must tell the user)', async () => {
    fakeVerifiedChannelDelete.mockResolvedValueOnce({
      success: false,
      alreadyGone: false,
      error: 'Missing Permissions',
    });
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // The transcript is safe, but the caller must NOT report a clean close.
    expect(result).toEqual({ success: true, archived: true, channelDeleted: false });
  });

  test('re-close append: posts header embed into the existing thread, no new thread', async () => {
    fakeRepoState.findOneByResult = { messageId: 'existing-app-thread' };
    const client = makeFakeClient(forumChannel);
    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result).toEqual({ success: true, archived: true, channelDeleted: true });
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(forumChannel.threads.fetch).toHaveBeenCalledWith('existing-app-thread', { force: true });
    const thread = forumState.threadsFetched.get('existing-app-thread');
    expect(thread.sentMessages[0]).toContain('[embed] 📋');
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test('re-close with a NULL messageId row: creates a thread and repoints (no silent loss)', async () => {
    // Pre-fix, a row with messageId=null matched neither branch: `archived`
    // stayed true and the channel was deleted with the transcript never
    // posted anywhere. It must take the recreate path instead.
    fakeRepoState.findOneByResult = { messageId: null };
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result).toEqual({ success: true, archived: true, channelDeleted: true });
    expect(forumChannel.threads.fetch).not.toHaveBeenCalled();
    expect(forumChannel.threads.create).toHaveBeenCalledTimes(1);
    expect(fakeRepoState.saveCalls).toHaveLength(1);
    expect(fakeRepoState.saveCalls[0].messageId).toBe(forumState.threadsCreated[0].id);
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test('B1: re-close into a DELETED thread (10003) recreates it, repoints messageId, deletes channel', async () => {
    fakeRepoState.findOneByResult = { messageId: 'deleted-app-thread' };
    forumState.fetchShouldThrow = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result).toEqual({ success: true, archived: true, channelDeleted: true });
    expect(forumChannel.threads.create).toHaveBeenCalledTimes(1);
    expect(fakeRepoState.saveCalls).toHaveLength(1);
    expect(fakeRepoState.saveCalls[0].messageId).toBe(forumState.threadsCreated[0].id);
    expect(fakeVerifiedChannelDelete).toHaveBeenCalledTimes(1);
  });

  test('B1: NON-10003 fetch error bubbles — archive fails, no recreate, channel preserved', async () => {
    fakeRepoState.findOneByResult = { messageId: 'existing-app-thread' };
    forumState.fetchShouldThrow = Object.assign(new Error('Missing Access'), { code: 50001 });
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result).toEqual({ success: false, archived: false });
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(fakeVerifiedChannelDelete).not.toHaveBeenCalled();
  });

  test('B2: forum post failure preserves the channel (no data loss)', async () => {
    forumState.createShouldThrow = new Error('Discord 50013 — missing permissions');
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result).toEqual({ success: false, archived: false });
    expect(fakeVerifiedChannelDelete).not.toHaveBeenCalled();
    expect(fakeRepoState.saveCalls).toHaveLength(0);
  });

  test('transcript fetch failure short-circuits before any forum write or channel delete', async () => {
    fakeFetchMessages.mockRejectedValue(new Error('Discord API timeout'));
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication(),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result).toEqual({ success: false, archived: false, transcriptFailed: true });
    expect(forumChannel.threads.create).not.toHaveBeenCalled();
    expect(fakeVerifiedChannelDelete).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Archival enrichment (v3.16.0): position / outcome / reviewer / closedBy
  // -------------------------------------------------------------------------

  /** Header embed of the first thread created (title + fields-by-name). */
  function createdHeader(forum: any): { title: string; fields: Record<string, string> } {
    const embed = forum.threads.create.mock.calls[0][0].message.embeds[0];
    return {
      title: embed.data.title,
      fields: Object.fromEntries(embed.data.fields.map((f: any) => [f.name, f.value])),
    };
  }

  test("position resolved from type='position_<id>' → emoji+title in header title, title in Type row", async () => {
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(fakePositionRepo.findOneBy).toHaveBeenCalledWith({ id: 7, guildId: 'guild-1' });
    const header = createdHeader(forumChannel);
    expect(header.title).toBe('📋 🛡️ Moderator — applicant');
    expect(header.fields.Type).toBe('Moderator');
  });

  test('orphaned position (row deleted) falls back to the generic Application header — close survives', async () => {
    fakePositionRepo.findOneBy.mockResolvedValue(null);
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_99' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result.archived).toBe(true);
    const header = createdHeader(forumChannel);
    expect(header.title).toBe('📋 Application — applicant');
    expect(header.fields.Type).toBe('Application');
  });

  test("position lookup DB error is swallowed (orphan fallback), not thrown from the un-try'd metadata region", async () => {
    fakePositionRepo.findOneBy.mockRejectedValue(new Error('transient DB error'));
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result.archived).toBe(true);
    expect(createdHeader(forumChannel).title).toBe('📋 Application — applicant');
  });

  test("outcome from the in-memory pre-close status ('accepted' — API approve path)", async () => {
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ status: 'accepted' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(createdHeader(forumChannel).fields.Outcome).toBe('Accepted');
  });

  test("outcome from the newest decisive statusHistory entry ('denied' — Discord workflow vocabulary)", async () => {
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({
        status: 'closed',
        statusHistory: [
          { status: 'submitted', changedBy: 'u1', changedAt: '2026-04-20T10:00:00Z' },
          { status: 'denied', changedBy: 'rev-1', changedAt: '2026-04-21T10:00:00Z' },
          { status: 'closed', changedBy: 'rev-1', changedAt: '2026-04-22T10:00:00Z' },
        ],
      }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(createdHeader(forumChannel).fields.Outcome).toBe('Rejected');
  });

  test('no decisive status anywhere → no Outcome row', async () => {
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ status: 'closed', statusHistory: [] }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(createdHeader(forumChannel).fields.Outcome).toBeUndefined();
  });

  test('RETRACTED decision is not reported: approved → moved back → closed yields no Outcome', async () => {
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({
        status: 'closed',
        statusHistory: [
          { status: 'submitted', changedBy: 'u1', changedAt: '2026-04-20T10:00:00Z' },
          { status: 'approved', changedBy: 'rev-1', changedAt: '2026-04-21T10:00:00Z' },
          { status: 'under-review', changedBy: 'rev-1', changedAt: '2026-04-21T12:00:00Z' }, // retraction
          { status: 'closed', changedBy: 'rev-1', changedAt: '2026-04-22T10:00:00Z' },
        ],
      }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // The withdrawn 'approved' must NOT resurface as the archived outcome.
    expect(createdHeader(forumChannel).fields.Outcome).toBeUndefined();
  });

  test("decision followed only by 'closed' IS reported (the normal accept-then-close flow)", async () => {
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({
        status: 'closed',
        statusHistory: [
          { status: 'approved', changedBy: 'rev-1', changedAt: '2026-04-21T10:00:00Z' },
          { status: 'closed', changedBy: 'rev-1', changedAt: '2026-04-22T10:00:00Z' },
        ],
      }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(createdHeader(forumChannel).fields.Outcome).toBe('Accepted');
  });

  test("custom workflow status 'constructor' does not leak Object.prototype into the outcome", async () => {
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      // A guild-defined status id 'constructor' would resolve to the inherited
      // Object constructor under a naive object lookup and throw in the embed.
      makeApplication({ status: 'constructor' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result.archived).toBe(true);
    expect(createdHeader(forumChannel).fields.Outcome).toBeUndefined();
  });

  test('reviewer fetch REJECTING degrades to an id-only Reviewed by row — close survives', async () => {
    const client = makeFakeClient(forumChannel, (id: string) => {
      if (id === 'rev-1') throw new Error('Unknown User');
      return { username: 'applicant' };
    });

    const result = await archiveAndCloseApplication(
      client,
      makeApplication({ reviewedBy: 'rev-1' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result.archived).toBe(true);
    expect(createdHeader(forumChannel).fields['Reviewed by']).toBe('`rev-1`');
  });

  test('reviewedBy resolves to a Reviewed by row; closedBy actor renders Closed by; Application # present', async () => {
    const client = makeFakeClient(forumChannel, (id: string) =>
      id === 'rev-1' ? { username: 'reviewer' } : { username: 'applicant' },
    );

    await archiveAndCloseApplication(
      client,
      makeApplication({ id: 55, reviewedBy: 'rev-1' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
      { id: 'staff-2', username: 'closer' },
    );

    const { fields } = createdHeader(forumChannel);
    expect(fields['Reviewed by']).toBe('reviewer (`rev-1`)');
    expect(fields['Closed by']).toBe('closer (`staff-2`)');
    expect(fields['Application #']).toBe('55');
  });

  // -------------------------------------------------------------------------
  // Forum tags (v3.16.1): position + Accepted/Rejected outcome, accumulation
  // -------------------------------------------------------------------------

  test('first close: applies position + outcome tags and persists them on the archive row', async () => {
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7', status: 'accepted' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // Two tags ensured: position (by position id) + outcome
    expect(fakeEnsureForumTag).toHaveBeenCalledTimes(2);
    expect(fakeEnsureForumTag.mock.calls[0][1]).toBe('position_7');
    expect(fakeEnsureForumTag.mock.calls[1][1]).toBe('outcome_accepted');
    // Applied to the new thread and persisted on the row
    expect(fakeApplyForumTags).toHaveBeenCalledTimes(1);
    expect(fakeApplyForumTags.mock.calls[0][2]).toEqual(['tag-position_7', 'tag-outcome_accepted']);
    expect(fakeRepoState.createCalls[0].forumTagIds).toEqual(['tag-position_7', 'tag-outcome_accepted']);
  });

  test('no position and no outcome: no tags ensured, row saved with empty tag list', async () => {
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ type: null, status: 'pending' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(fakeEnsureForumTag).not.toHaveBeenCalled();
    expect(fakeApplyForumTags).not.toHaveBeenCalled();
    expect(fakeRepoState.createCalls[0].forumTagIds).toEqual([]);
  });

  test('re-close append: accumulates the new outcome tag onto the existing archive row', async () => {
    // Prior close tagged the position; this close is the decision.
    fakeRepoState.findOneByResult = { messageId: 'existing-thread', forumTagIds: ['tag-position_7'] };
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7', status: 'rejected' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // Position tag already present; the merged set adds the outcome tag.
    const applied = fakeApplyForumTags.mock.calls[0][2];
    expect(applied).toEqual(['tag-position_7', 'tag-outcome_rejected']);
    // Persisted the accumulated set
    const savedRow = fakeRepoState.saveCalls.at(-1);
    expect(savedRow.forumTagIds).toEqual(['tag-position_7', 'tag-outcome_rejected']);
  });

  test('re-close append: no NEW tags → no re-apply, no extra save', async () => {
    fakeRepoState.findOneByResult = {
      messageId: 'existing-thread',
      forumTagIds: ['tag-position_7', 'tag-outcome_accepted'],
    };
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7', status: 'accepted' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // Both tags already on the row → nothing new to apply or persist.
    expect(fakeApplyForumTags).not.toHaveBeenCalled();
    expect(fakeRepoState.saveCalls).toHaveLength(0);
  });

  test('recreate-on-10003: merges existing + new tags, applies to the recreated thread, persists the applied set', async () => {
    // Prior close tagged the position; the thread was since deleted (10003), so
    // this close recreates it and must carry the merged tags onto the new thread.
    fakeRepoState.findOneByResult = { messageId: 'deleted-thread', forumTagIds: ['tag-position_7'] };
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    forumState.fetchShouldThrow = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7', status: 'accepted' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    expect(result.archived).toBe(true);
    // A NEW thread was created (recreate path), and the merged set applied to it.
    expect(forumChannel.threads.create).toHaveBeenCalledTimes(1);
    expect(fakeApplyForumTags.mock.calls[0][2]).toEqual(['tag-position_7', 'tag-outcome_accepted']);
    // Row repointed at the new thread and persisted with the applied tags.
    const savedRow = fakeRepoState.saveCalls.at(-1);
    expect(savedRow.messageId).toBe(forumState.threadsCreated[0].id);
    expect(savedRow.forumTagIds).toEqual(['tag-position_7', 'tag-outcome_accepted']);
  });

  test('recreate-on-10003: persists only the applied set when the 5-tag cap drops a tag', async () => {
    fakeRepoState.findOneByResult = { messageId: 'deleted-thread', forumTagIds: ['a', 'b', 'c', 'd'] };
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    forumState.fetchShouldThrow = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    fakeApplyForumTags.mockImplementation(async (_f: any, _t: string, tags: string[]) => tags.slice(0, 5));
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7', status: 'accepted' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // merged = [a,b,c,d, tag-position_7, tag-outcome_accepted]; cap keeps 5 —
    // the DB must record the applied 5, NOT the intended 6 (no phantom tag).
    const savedRow = fakeRepoState.saveCalls.at(-1);
    expect(savedRow.forumTagIds).toEqual(['a', 'b', 'c', 'd', 'tag-position_7']);
    expect(savedRow.forumTagIds).toHaveLength(5);
  });

  test('recreate-on-10003: applyForumTags error (null) falls back to the intended merge so the row still saves', async () => {
    fakeRepoState.findOneByResult = { messageId: 'deleted-thread', forumTagIds: ['tag-position_7'] };
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    forumState.fetchShouldThrow = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    fakeApplyForumTags.mockResolvedValue(null); // tag apply failed on the recreated thread
    const client = makeFakeClient(forumChannel);

    const result = await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7', status: 'accepted' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // Archive must still succeed (the transcript matters more than the tags),
    // and the row is repointed with the best-effort intended set.
    expect(result.archived).toBe(true);
    const savedRow = fakeRepoState.saveCalls.at(-1);
    expect(savedRow.messageId).toBe(forumState.threadsCreated[0].id);
    expect(savedRow.forumTagIds).toEqual(['tag-position_7', 'tag-outcome_accepted']);
  });

  test('re-close append: persists only tags that actually landed (5-tag cap dropped the new one)', async () => {
    fakeRepoState.findOneByResult = {
      messageId: 'existing-thread',
      forumTagIds: ['a', 'b', 'c', 'd'], // 4 pre-existing (manual/other)
    };
    fakePositionRepo.findOneBy.mockResolvedValue({ id: 7, title: 'Moderator', emoji: '🛡️' });
    // Cap simulation: only the first 5 of the merged set survive.
    fakeApplyForumTags.mockImplementation(async (_f: any, _t: string, tags: string[]) => tags.slice(0, 5));
    const client = makeFakeClient(forumChannel);

    await archiveAndCloseApplication(
      client,
      makeApplication({ type: 'position_7', status: 'accepted' }),
      'guild-1',
      makeChannel(),
      'forum-archive-1',
      deps,
    );

    // merged = [a,b,c,d, tag-position_7, tag-outcome_accepted]; applied caps to 5.
    const savedRow = fakeRepoState.saveCalls.at(-1);
    expect(savedRow.forumTagIds).toEqual(['a', 'b', 'c', 'd', 'tag-position_7']);
    expect(savedRow.forumTagIds).toHaveLength(5);
  });
});
