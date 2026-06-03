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

function makeBaitLogRepo(existing: any) {
  return {
    findOne: jest.fn(async () => existing ?? null),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
  };
}

function setup(opts: { baitLog?: any; botId?: string } = {}) {
  const baitLogRepo = makeBaitLogRepo(opts.baitLog);
  const pendingRepo = { delete: jest.fn(async () => ({ affected: 1 })) };
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
  registerAuditLogEntryCreateHandler(client);
  return { handler: handler!, baitLogRepo, pendingRepo, idempotencyRepo };
}

const banEntry = (executorId: string, targetId = 'u1', id = 'audit-1') =>
  ({ action: AuditLogEvent.MemberBanAdd, targetId, executorId, id, changes: [] }) as any;
const unbanEntry = (executorId: string, targetId = 'u1', id = 'audit-2') =>
  ({ action: AuditLogEvent.MemberBanRemove, targetId, executorId, id, changes: [] }) as any;
const timeoutEntry = (executorId: string, set = true, targetId = 'u1', id = 'audit-3') =>
  ({
    action: AuditLogEvent.MemberUpdate,
    targetId,
    executorId,
    id,
    changes: set
      ? [{ key: 'communication_disabled_until', new: '2026-01-01T00:00:00Z' }]
      : [{ key: 'nick', new: 'whatever' }],
  }) as any;

describe('auditLogEntryCreate handler', () => {
  describe('bot-self confirmation', () => {
    test('patches discordAuditLogId + actionConfirmedAt on the recent bait log', async () => {
      const log: any = { id: 5, actionConfirmedAt: null, discordAuditLogId: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot'), GUILD);
      expect(log.discordAuditLogId).toBe('audit-1');
      expect(log.actionConfirmedAt).toBeInstanceOf(Date);
      expect(baitLogRepo.save).toHaveBeenCalledWith(log);
    });

    test('is idempotent — already-confirmed log is not re-saved', async () => {
      const log: any = { id: 5, actionConfirmedAt: new Date(), discordAuditLogId: 'old' };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('bot'), GUILD);
      expect(baitLogRepo.save).not.toHaveBeenCalled();
    });

    test('no matching bait log → no save (non-bait bot action)', async () => {
      const { handler, baitLogRepo } = setup({ baitLog: null, botId: 'bot' });
      await handler(banEntry('bot'), GUILD);
      expect(baitLogRepo.save).not.toHaveBeenCalled();
    });

    test('a timeout-set MemberUpdate by the bot confirms the log', async () => {
      const log: any = { id: 7, actionConfirmedAt: null };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(timeoutEntry('bot', true), GUILD);
      expect(baitLogRepo.save).toHaveBeenCalledWith(log);
    });

    test('a non-timeout MemberUpdate is ignored', async () => {
      const { handler, baitLogRepo } = setup({ baitLog: { id: 1, actionConfirmedAt: null }, botId: 'bot' });
      await handler(timeoutEntry('bot', false), GUILD);
      expect(baitLogRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('mod-supersedes-us', () => {
    test('claims an idempotency key, cancels pending actions, and updates an existing queued log', async () => {
      const log: any = { id: 9, actionTaken: 'queued', executorId: null };
      const { handler, baitLogRepo, pendingRepo, idempotencyRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('mod-77'), GUILD);

      // idempotency key claimed with the MOD's executor id
      expect(idempotencyRepo.save).toHaveBeenCalled();
      expect(idempotencyRepo.create).toHaveBeenCalledWith(expect.objectContaining({ executorId: 'mod-77', action: 'ban' }));
      // pending actions cancelled
      expect(pendingRepo.delete).toHaveBeenCalledWith({ guildId: 'g1', userId: 'u1' });
      // existing queued row updated in place
      expect(log.actionTaken).toBe('superseded-by-mod');
      expect(log.executorId).toBe('mod-77');
      expect(log.discordAuditLogId).toBe('audit-1');
      expect(baitLogRepo.save).toHaveBeenCalledWith(log);
    });

    test('no existing log → inserts a minimal superseded-by-mod row', async () => {
      const { handler, baitLogRepo } = setup({ baitLog: null, botId: 'bot' });
      await handler(banEntry('mod-77'), GUILD);
      expect(baitLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ actionTaken: 'superseded-by-mod', executorId: 'mod-77', userId: 'u1' }),
      );
      expect(baitLogRepo.save).toHaveBeenCalled();
    });

    test('already-actioned log (e.g. ban) is NOT overwritten by a slightly-late mod action', async () => {
      const log: any = { id: 9, actionTaken: 'ban', executorId: 'bot' };
      const { handler, baitLogRepo } = setup({ baitLog: log, botId: 'bot' });
      await handler(banEntry('mod-77'), GUILD);
      // case (b): not updatable state and not absent → no save of the log row
      expect(log.actionTaken).toBe('ban');
      expect(baitLogRepo.save).not.toHaveBeenCalled();
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
    await handler({ action: AuditLogEvent.MemberBanAdd, targetId: null, executorId: 'mod', id: 'x', changes: [] }, GUILD);
    expect(baitLogRepo.findOne).not.toHaveBeenCalled();
  });
});
