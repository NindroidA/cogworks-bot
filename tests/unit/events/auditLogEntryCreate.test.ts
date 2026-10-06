/**
 * auditLogEntryCreate handler tests (bait moderation attribution).
 *
 * Exercises the real registered handler (via a fake client that captures the
 * GuildAuditLogEntryCreate callback) across its three paths: bot-self confirm,
 * mod-supersedes-us, and unban tracking — plus the MemberUpdate timeout-set
 * filter. Repos are provided through an AppDataSource.getRepository patch (the
 * Linux-stable seam the sibling handler tests use), so no mock.module().
 *
 * Automates smoke-test checklist §6.
 */

import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test';
import { AuditLogEvent, Events } from 'discord.js';
import { registerAuditLogEntryCreateHandler } from '../../../src/events/auditLogEntryCreate';
import { AppDataSource } from '../../../src/typeorm';
import { BaitChannelLog } from '../../../src/typeorm/entities/bait/BaitChannelLog';
import { IdempotencyKey } from '../../../src/typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../../../src/typeorm/entities/bait/PendingAction';

const GUILD = { id: 'g1' } as any;

let originalGetRepository: ((e: unknown) => unknown) | undefined;

beforeAll(() => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository;
});

afterAll(() => {
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

/**
 * Honours the filters the handler relies on (actionTaken equality / In(),
 * messageId), so a row a real query wouldn't return isn't returned here.
 */
function makeBaitLogRepo(existing: any) {
  return {
    findOne: jest.fn(async (opts: any) => {
      if (!existing) return null;
      const where = opts?.where ?? {};
      const state = where.actionTaken;
      if (typeof state === 'string' && state !== existing.actionTaken) return null;
      if (Array.isArray(state?.value) && !state.value.includes(existing.actionTaken)) return null;
      if (where.messageId && where.messageId !== existing.messageId) return null;
      return existing;
    }),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
    /** Conditional update: applies only when the row matches id and is still unconfirmed. */
    update: jest.fn(async (where: any, patch: any) => {
      const matches =
        existing &&
        where.id === existing.id &&
        (where.actionConfirmedAt === undefined || existing.actionConfirmedAt == null);
      if (!matches) return { affected: 0 };
      Object.assign(existing, patch);
      return { affected: 1 };
    }),
  };
}

function setup(opts: { baitLog?: any; botId?: string; pending?: any[]; retryDelays?: number[] } = {}) {
  const baitLogRepo = makeBaitLogRepo(opts.baitLog);
  const pendingRepo = {
    find: jest.fn(async () => opts.pending ?? []),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const idempotencyRepo = { create: jest.fn((x: any) => x), save: jest.fn(async (x: any) => x) };
  const repoMap = new Map<unknown, unknown>([
    [BaitChannelLog, baitLogRepo],
    [PendingAction, pendingRepo],
    [IdempotencyKey, idempotencyRepo],
  ]);
  (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = (e: unknown) =>
    repoMap.get(e);

  let handler: ((entry: any, guild: any) => Promise<void>) | undefined;
  const client = {
    user: { id: opts.botId ?? 'bot' },
    on: (ev: unknown, cb: (entry: any, guild: any) => Promise<void>) => {
      if (ev === Events.GuildAuditLogEntryCreate) handler = cb;
    },
  } as any;
  registerAuditLogEntryCreateHandler(client, { confirmRetryDelaysMs: opts.retryDelays ?? [] });
  return { handler: handler!, baitLogRepo, pendingRepo, idempotencyRepo };
}

const BAIT_REASON = 'cogworks:bait score=87 ch=#trap flags=[newAccount] msgId=555 Instant action mode';
const banEntry = (executorId: string, targetId = 'u1', id = 'audit-1', reason: string | null = BAIT_REASON) =>
  ({ action: AuditLogEvent.MemberBanAdd, targetId, executorId, id, reason, changes: [] }) as any;
const kickEntry = (executorId: string, targetId = 'u1', id = 'audit-4') =>
  ({ action: AuditLogEvent.MemberKick, targetId, executorId, id, reason: null, changes: [] }) as any;
const unbanEntry = (executorId: string, targetId = 'u1', id = 'audit-2') =>
  ({ action: AuditLogEvent.MemberBanRemove, targetId, executorId, id, changes: [] }) as any;
const timeoutEntry = (executorId: string, set = true, targetId = 'u1', id = 'audit-3') =>
  ({
    action: AuditLogEvent.MemberUpdate,
    targetId,
    executorId,
    id,
    reason: BAIT_REASON,
    changes: set
      ? [{ key: 'communication_disabled_until', new: '2026-01-01T00:00:00Z' }]
      : [{ key: 'nick', new: 'whatever' }],
  }) as any;

/** Retry rows have attempts >= 1; grace rows attempts = 0. */
const retryRow = (id: number, action: string, attempts = 1) => ({ id, action, attempts, deadAt: null });

/** Wait (real clock) until `check` passes or the deadline hits. */
async function eventually(check: () => boolean, ms = 500): Promise<void> {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await new Promise(r => setTimeout(r, 5));
}

describe('auditLogEntryCreate handler', () => {
  describe('bot-self confirmation', () => {
    test('patches discordAuditLogId + actionConfirmedAt on the bait log for that message', async () => {
      const log: any = {
        id: 5,
        actionTaken: 'ban',
        messageId: '555',
        actionConfirmedAt: null,
        discordAuditLogId: null,
      };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot'), GUILD);
      expect(log.discordAuditLogId).toBe('audit-1');
      expect(log.actionConfirmedAt).toBeInstanceOf(Date);
      expect(baitLogRepo.findOne.mock.calls[0][0].where.messageId).toBe('555');
      // conditional update (guild-scoped, only while unconfirmed), never save()
      const [where] = baitLogRepo.update.mock.calls[0] as any[];
      expect(where.id).toBe(5);
      expect(where.guildId).toBe('g1');
      expect(where.actionConfirmedAt).toBeDefined();
      expect(baitLogRepo.save).not.toHaveBeenCalled();
    });

    test('is idempotent — an already-confirmed log keeps its audit ID', async () => {
      const log: any = {
        id: 5,
        actionTaken: 'ban',
        messageId: '555',
        actionConfirmedAt: new Date(),
        discordAuditLogId: 'old',
      };
      const { handler } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot'), GUILD);
      expect(log.discordAuditLogId).toBe('old');
    });

    test('the ban half of a softban (a bait kick) confirms the kick row for that message', async () => {
      const log: any = { id: 8, actionTaken: 'kick', messageId: '555', actionConfirmedAt: null };
      const { handler } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot', 'u1', 'audit-5', `Softban — ${BAIT_REASON}`), GUILD);
      expect(log.discordAuditLogId).toBe('audit-5');
      expect(log.actionConfirmedAt).toBeInstanceOf(Date);
    });

    test('a bot action without a bait reason is not correlated', async () => {
      const log: any = { id: 5, actionTaken: 'ban', messageId: '555', actionConfirmedAt: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot', 'u1', 'audit-1', 'Banned via /ban'), GUILD);
      await handler(banEntry('bot', 'u1', 'audit-1', 'spam, see cogworks:bait docs'), GUILD);
      await handler(banEntry('bot', 'u1', 'audit-1', null), GUILD);
      expect(baitLogRepo.findOne).not.toHaveBeenCalled();
      expect(log.actionConfirmedAt).toBe(null);
    });

    test('an earlier deleted-in-time or whitelisted row is never stamped', async () => {
      const log: any = { id: 4, actionTaken: 'deleted-in-time', messageId: '555', actionConfirmedAt: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot'), GUILD);
      expect(baitLogRepo.update).not.toHaveBeenCalled();
      expect(log.actionConfirmedAt).toBe(null);
    });

    test('a row for a different message is never stamped', async () => {
      const log: any = { id: 4, actionTaken: 'ban', messageId: '444', actionConfirmedAt: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot'), GUILD);
      expect(baitLogRepo.update).not.toHaveBeenCalled();
    });

    test('row not written yet → looked up again after the retry delay, then stamped', async () => {
      const log: any = { id: 6, actionTaken: 'ban', messageId: '555', actionConfirmedAt: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot', retryDelays: [1] });
      baitLogRepo.findOne.mockImplementationOnce(async () => null); // executeAction hasn't logged yet
      await handler(banEntry('bot'), GUILD);
      expect(baitLogRepo.update).not.toHaveBeenCalled();
      await eventually(() => baitLogRepo.update.mock.calls.length > 0);
      expect(baitLogRepo.findOne).toHaveBeenCalledTimes(2);
      expect(log.discordAuditLogId).toBe('audit-1');
    });

    test('row never written → gives up after the last retry', async () => {
      const { handler, baitLogRepo } = setup({ baitLog: null, botId: 'bot', retryDelays: [1, 1] });
      await handler(banEntry('bot'), GUILD);
      await eventually(() => baitLogRepo.findOne.mock.calls.length >= 3);
      await new Promise(r => setTimeout(r, 20));
      expect(baitLogRepo.findOne).toHaveBeenCalledTimes(3);
      expect(baitLogRepo.update).not.toHaveBeenCalled();
    });

    test('a timeout-set MemberUpdate by the bot confirms the log', async () => {
      const log: any = { id: 7, actionTaken: 'timeout', messageId: '555', actionConfirmedAt: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(timeoutEntry('bot', true), GUILD);
      expect(log.discordAuditLogId).toBe('audit-3');
    });

    test('a non-timeout MemberUpdate is ignored', async () => {
      const { handler, baitLogRepo } = setup({ baitLog: { id: 1, actionConfirmedAt: null }, botId: 'bot' });
      await handler(timeoutEntry('bot', false), GUILD);
      expect(baitLogRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('mod-supersedes-us', () => {
    test('ordinary moderation (nothing bait pending) is ignored: no key, no deletes, no log rows', async () => {
      const { handler, baitLogRepo, pendingRepo, idempotencyRepo } = setup({ baitLog: null, pending: [] });
      await handler(banEntry('mod-77', 'u1', 'audit-1', null), GUILD);
      await handler(kickEntry('mod-77'), GUILD);
      await handler(timeoutEntry('mod-77'), GUILD);
      expect(idempotencyRepo.save).not.toHaveBeenCalled();
      expect(pendingRepo.delete).not.toHaveBeenCalled();
      expect(baitLogRepo.save).not.toHaveBeenCalled();
      // dead-lettered rows don't make a user bait-relevant
      expect(pendingRepo.find.mock.calls[0][0].where.deadAt).toBeDefined();
    });

    test('an already-actioned log (e.g. ban) does not make a later mod action bait-relevant', async () => {
      const log: any = { id: 9, actionTaken: 'ban', executorId: 'bot' };
      const { handler, baitLogRepo, idempotencyRepo } = setup({ baitLog: log, pending: [] });
      await handler(banEntry('mod-77'), GUILD);
      expect(log.actionTaken).toBe('ban');
      expect(baitLogRepo.save).not.toHaveBeenCalled();
      expect(idempotencyRepo.save).not.toHaveBeenCalled();
    });

    test('claims an idempotency key, cancels covered retries, and updates an existing queued log', async () => {
      const log: any = { id: 9, actionTaken: 'queued', executorId: null };
      const { handler, baitLogRepo, pendingRepo, idempotencyRepo } = setup({
        baitLog: log,
        pending: [retryRow(1, 'ban')],
      });
      await handler(banEntry('mod-77'), GUILD);

      // idempotency key claimed with the MOD's executor id
      expect(idempotencyRepo.save).toHaveBeenCalled();
      expect(idempotencyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ executorId: 'mod-77', action: 'ban' }),
      );
      // covered retry deleted, guild-scoped
      const del = pendingRepo.delete.mock.calls[0][0] as any;
      expect(del.guildId).toBe('g1');
      expect(del.id.value).toEqual([1]);
      // existing queued row updated in place
      expect(log.actionTaken).toBe('superseded-by-mod');
      expect(log.executorId).toBe('mod-77');
      expect(log.discordAuditLogId).toBe('audit-1');
      expect(baitLogRepo.save).toHaveBeenCalledWith(log);
    });

    test('a mod timeout does not cancel a queued ban retry, and the queued log stays', async () => {
      const log: any = { id: 9, actionTaken: 'queued' };
      const { handler, baitLogRepo, pendingRepo, idempotencyRepo } = setup({
        baitLog: log,
        pending: [retryRow(1, 'ban', 2)],
      });
      await handler(timeoutEntry('mod-77'), GUILD);
      expect(idempotencyRepo.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'timeout' }));
      expect(pendingRepo.delete).not.toHaveBeenCalled();
      expect(log.actionTaken).toBe('queued');
      expect(baitLogRepo.save).not.toHaveBeenCalled();
    });

    test('a mod kick cancels a timeout retry but keeps a ban retry', async () => {
      const { handler, pendingRepo } = setup({
        baitLog: null,
        pending: [retryRow(1, 'timeout'), retryRow(2, 'ban')],
      });
      await handler(kickEntry('mod-77'), GUILD);
      expect((pendingRepo.delete.mock.calls[0][0] as any).id.value).toEqual([1]);
    });

    test('grace rows stay with the manager: key claimed, row kept, no log written', async () => {
      const { handler, baitLogRepo, pendingRepo, idempotencyRepo } = setup({
        baitLog: null,
        pending: [retryRow(3, 'ban', 0)],
      });
      await handler(banEntry('mod-77'), GUILD);
      expect(idempotencyRepo.save).toHaveBeenCalled();
      expect(pendingRepo.delete).not.toHaveBeenCalled();
      expect(baitLogRepo.save).not.toHaveBeenCalled();
    });

    test('no recent log but a retry was cancelled → inserts a minimal superseded-by-mod row', async () => {
      const { handler, baitLogRepo } = setup({ baitLog: null, pending: [retryRow(1, 'softban')] });
      await handler(banEntry('mod-77'), GUILD);
      expect(baitLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ actionTaken: 'superseded-by-mod', executorId: 'mod-77', userId: 'u1' }),
      );
      expect(baitLogRepo.save).toHaveBeenCalled();
    });
  });

  describe('unban tracking', () => {
    test('stamps unbannedAt + unbannedBy on the matching ban row', async () => {
      const log: any = { id: 11, actionTaken: 'ban', unbannedAt: null, unbannedBy: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(unbanEntry('mod-88'), GUILD);
      expect(log.unbannedAt).toBeInstanceOf(Date);
      expect(log.unbannedBy).toBe('mod-88');
      expect(baitLogRepo.save).toHaveBeenCalledWith(log);
    });

    test('no matching ban row → no save', async () => {
      const { handler, baitLogRepo } = setup({ baitLog: null, botId: 'bot' });
      await handler(unbanEntry('mod-88'), GUILD);
      expect(baitLogRepo.save).not.toHaveBeenCalled();
    });
  });

  test('entries missing targetId or executorId are ignored', async () => {
    const { handler, baitLogRepo } = setup({ baitLog: { id: 1 }, botId: 'bot' });
    await handler(
      { action: AuditLogEvent.MemberBanAdd, targetId: null, executorId: 'mod', id: 'x', changes: [] },
      GUILD,
    );
    expect(baitLogRepo.findOne).not.toHaveBeenCalled();
  });
});
