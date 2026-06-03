/**
 * RetryQueue behavioral tests.
 *
 * Covers enqueue backoff/dead-letter math and the per-tick retry lifecycle
 * (executed → remove, duplicate → remove, queued → attempts++/backoff, failed
 * or MAX_ATTEMPTS → dead-letter, orphaned-grace promotion, guild-gone →
 * terminal). The REST executor is injected (deps.executeBanAction) so we drive
 * outcomes without mock.module() — which is process-shared on bun and would
 * poison the sibling banExecutor suite.
 *
 * Automates smoke-test checklist §3 (retry queue).
 */

import { describe, expect, jest, test } from 'bun:test';
import { RetryQueue } from '../../../../src/utils/baitChannel/retryQueue';

function makeRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    guildId: 'g1',
    userId: 'u1',
    messageId: 'm1',
    channelId: 'c1',
    action: 'ban',
    suspicionScore: 95,
    attempts: 1,
    deadAt: null,
    lastError: null,
    warningMessageId: null,
    expiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

function makeQueue(opts: { due?: any[]; existing?: any; execResult?: any; member?: any } = {}) {
  const saved: any[] = [];
  const removed: any[] = [];
  const created: any[] = [];
  const pendingActionRepo = {
    findOne: jest.fn(async () => opts.existing ?? null),
    find: jest.fn(async () => opts.due ?? []),
    create: jest.fn((x: any) => {
      created.push(x);
      return x;
    }),
    save: jest.fn(async (x: any) => {
      saved.push(x);
      return x;
    }),
    remove: jest.fn(async (x: any) => {
      removed.push(x);
      return x;
    }),
  };
  const fakeGuild = {
    id: 'g1',
    members: { fetch: jest.fn(async () => ('member' in opts ? opts.member : { id: 'u1' })) },
  };
  const client = { user: { id: 'bot' }, guilds: { fetch: jest.fn(async () => fakeGuild) } };
  const executeBanAction = jest.fn(async () => opts.execResult ?? { status: 'executed' });
  const mgr = new RetryQueue({
    client,
    pendingActionRepo,
    idempotencyRepo: {},
    executeBanAction,
  } as any);
  return { mgr, pendingActionRepo, executeBanAction, saved, removed, created, client };
}

describe('RetryQueue', () => {
  describe('enqueue', () => {
    test('creates a fresh retry row with attempts=1 and ~5s backoff', async () => {
      const { mgr, created } = makeQueue({ existing: null });
      await mgr.enqueue({
        guildId: 'g1',
        userId: 'u1',
        messageId: 'm1',
        channelId: 'c1',
        action: 'ban',
        suspicionScore: 95,
        lastError: '429',
      });
      expect(created).toHaveLength(1);
      expect(created[0].attempts).toBe(1);
      const delta = created[0].expiresAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(3_000);
      expect(delta).toBeLessThan(6_000);
    });

    test('increments an existing row and applies the next (30s) backoff', async () => {
      const existing = makeRow({ attempts: 1 });
      const { mgr, saved } = makeQueue({ existing });
      await mgr.enqueue({
        guildId: 'g1',
        userId: 'u1',
        messageId: 'm1',
        channelId: 'c1',
        action: 'ban',
        suspicionScore: 95,
        lastError: '429',
      });
      expect(existing.attempts).toBe(2);
      expect(existing.deadAt == null).toBe(true);
      const delta = existing.expiresAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(25_000);
      expect(delta).toBeLessThan(35_000);
      expect(saved).toContain(existing);
    });

    test('dead-letters an existing row once it reaches MAX_ATTEMPTS', async () => {
      const existing = makeRow({ attempts: 2 }); // +1 → 3 = MAX
      const { mgr } = makeQueue({ existing });
      await mgr.enqueue({
        guildId: 'g1',
        userId: 'u1',
        messageId: 'm1',
        channelId: 'c1',
        action: 'ban',
        suspicionScore: 95,
        lastError: 'timeout',
      });
      expect(existing.attempts).toBe(3);
      expect(existing.deadAt).toBeInstanceOf(Date);
    });
  });

  describe('tick / retry lifecycle', () => {
    test('executed action removes the row', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, removed, executeBanAction } = makeQueue({ due: [row], execResult: { status: 'executed' } });
      await (mgr as any).tick();
      expect(executeBanAction).toHaveBeenCalled();
      expect(removed).toContain(row);
    });

    test('duplicate (already done elsewhere) removes the row', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, removed } = makeQueue({ due: [row], execResult: { status: 'duplicate' } });
      await (mgr as any).tick();
      expect(removed).toContain(row);
    });

    test('still-queued increments attempts + sets the next backoff (row kept)', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, removed, saved } = makeQueue({ due: [row], execResult: { status: 'queued', failureReason: '429' } });
      await (mgr as any).tick();
      expect(removed).not.toContain(row);
      expect(row.attempts).toBe(2);
      expect(row.deadAt).toBeNull();
      expect(saved).toContain(row);
    });

    test('terminal failure dead-letters the row', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, saved } = makeQueue({ due: [row], execResult: { status: 'failed', failureReason: 'missing perms' } });
      await (mgr as any).tick();
      expect(row.deadAt).toBeInstanceOf(Date);
      expect(row.lastError).toBe('missing perms');
      expect(saved).toContain(row);
    });

    test('reaching MAX_ATTEMPTS dead-letters even on a retryable status', async () => {
      const row = makeRow({ attempts: 2 }); // +1 → 3 = MAX
      const { mgr } = makeQueue({ due: [row], execResult: { status: 'queued', failureReason: '429' } });
      await (mgr as any).tick();
      expect(row.attempts).toBe(3);
      expect(row.deadAt).toBeInstanceOf(Date);
    });

    test('orphaned grace row (attempts=0) is promoted and executed', async () => {
      const row = makeRow({ attempts: 0 });
      const { mgr, removed, executeBanAction } = makeQueue({ due: [row], execResult: { status: 'executed' } });
      await (mgr as any).tick();
      expect(executeBanAction).toHaveBeenCalled();
      expect(removed).toContain(row);
    });

    test('guild no longer accessible → terminal dead-letter, no executor call', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, executeBanAction } = makeQueue({ due: [row] });
      (mgr as any).deps.client.guilds.fetch = jest.fn(async () => null);
      await (mgr as any).tick();
      expect(executeBanAction).not.toHaveBeenCalled();
      expect(row.deadAt).toBeInstanceOf(Date);
      expect(row.lastError).toContain('guild not accessible');
    });
  });
});
