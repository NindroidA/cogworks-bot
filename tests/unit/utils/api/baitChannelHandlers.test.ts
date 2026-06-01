/**
 * Bait internal API handler tests — the dashboard/inspection surface.
 *
 * Covers the read endpoints the smoke test (and bait-inspect harness) rely on
 * — config, pending-actions, logs, raid-mode/status — plus the config update
 * (the route formerly registered as an unreachable PATCH, now POST
 * /bait-channel/config/update).
 *
 * The handlers read through module-scope lazyRepo proxies, which cache the
 * resolved repository on first access. So — like ticketHandlers.test — we
 * patch AppDataSource.getRepository ONCE with stable fakes and mutate their
 * state per test (swapping the repo per-test wouldn't take effect). No
 * mock.module().
 *
 * Automates smoke-test checklist §11.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { AuditLog } from '../../../../src/typeorm/entities/AuditLog';
import { BaitChannelConfig } from '../../../../src/typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../../../../src/typeorm/entities/bait/BaitChannelLog';
import { PendingAction } from '../../../../src/typeorm/entities/bait/PendingAction';
import { registerBaitChannelHandlers } from '../../../../src/utils/api/handlers/baitChannelHandlers';
import { AppDataSource } from '../../../../src/typeorm';

type RouteHandler = (guildId: string, body: any, url: string) => Promise<any>;

const state: { config: any; pending: any[]; logs: any[] } = { config: null, pending: [], logs: [] };

const configRepo = {
  findOne: jest.fn(async () => state.config),
  save: jest.fn(async (x: any) => x),
};
const pendingRepo = { find: jest.fn(async () => state.pending), findOne: jest.fn(), remove: jest.fn() };
const logRepo = { find: jest.fn(async () => state.logs) };
const auditRepo = { create: jest.fn((x: any) => x), save: jest.fn(async (x: any) => x) };

let routes: Map<string, RouteHandler>;
let originalGetRepository: ((e: unknown) => unknown) | undefined;

const route = (key: string) => routes.get(key) as RouteHandler;

beforeAll(() => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository;
  const repoMap = new Map<unknown, unknown>([
    [BaitChannelConfig, configRepo],
    [BaitChannelLog, logRepo],
    [PendingAction, pendingRepo],
    [AuditLog, auditRepo],
  ]);
  (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = (e: unknown) =>
    repoMap.get(e) ?? {};

  routes = new Map<string, RouteHandler>();
  const client = { guilds: { fetch: jest.fn(async () => null) } } as any;
  registerBaitChannelHandlers(client, routes);
});

afterAll(() => {
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  state.config = null;
  state.pending = [];
  state.logs = [];
  configRepo.findOne.mockClear();
  configRepo.save.mockClear();
  pendingRepo.find.mockClear();
  logRepo.find.mockClear();
  auditRepo.save.mockClear();
});

describe('bait internal API handlers', () => {
  describe('GET /bait-channel/config', () => {
    test('returns the config row', async () => {
      state.config = { guildId: 'g1', enabled: true, raidModeThreshold: 5 };
      const res = await route('GET /bait-channel/config')('g1', {}, '');
      expect(res).toEqual({ config: state.config });
    });

    test('returns { config: null } when unconfigured', async () => {
      state.config = null;
      const res = await route('GET /bait-channel/config')('g1', {}, '');
      expect(res).toEqual({ config: null });
    });
  });

  describe('POST /bait-channel/config/update', () => {
    test('applies fields, saves, writes an audit log, and reports patched keys', async () => {
      state.config = { guildId: 'g1', enabled: true, raidModeThreshold: 5 };
      const res = await route('POST /bait-channel/config/update')(
        'g1',
        { enabled: false, raidModeThreshold: 7, triggeredBy: 'tester' },
        '',
      );
      expect(state.config.enabled).toBe(false);
      expect(state.config.raidModeThreshold).toBe(7);
      expect(configRepo.save).toHaveBeenCalledWith(state.config);
      expect(auditRepo.save).toHaveBeenCalled(); // writeAuditLog
      expect(res.success).toBe(true);
      expect(res.patched).toEqual(expect.arrayContaining(['enabled', 'raidModeThreshold']));
    });

    test('404 when the guild has no bait config', async () => {
      state.config = null;
      await expect(route('POST /bait-channel/config/update')('g1', { enabled: false }, '')).rejects.toThrow();
    });

    test('rejects an out-of-range logRetentionDays', async () => {
      state.config = { guildId: 'g1' };
      await expect(route('POST /bait-channel/config/update')('g1', { logRetentionDays: 9999 }, '')).rejects.toThrow();
    });
  });

  describe('GET /bait-channel/pending-actions', () => {
    test('returns rows + count for the default (active) status', async () => {
      state.pending = [{ id: 1 }, { id: 2 }];
      const res = await route('GET /bait-channel/pending-actions')(
        'g1',
        {},
        '/internal/guilds/g1/bait-channel/pending-actions',
      );
      expect(res.count).toBe(2);
      expect(res.pendingActions).toEqual(state.pending);
      expect(pendingRepo.find).toHaveBeenCalled();
    });

    test('accepts status=dead and status=all', async () => {
      await expect(route('GET /bait-channel/pending-actions')('g1', {}, '/x?status=dead')).resolves.toBeDefined();
      await expect(route('GET /bait-channel/pending-actions')('g1', {}, '/x?status=all')).resolves.toBeDefined();
    });

    test('rejects an invalid status', async () => {
      await expect(route('GET /bait-channel/pending-actions')('g1', {}, '/x?status=bogus')).rejects.toThrow();
    });
  });

  describe('GET /bait-channel/logs', () => {
    test('returns filtered logs', async () => {
      state.logs = [{ id: 1, actionTaken: 'ban' }];
      const res = await route('GET /bait-channel/logs')('g1', {}, '/x?days=7&action=ban');
      expect(res).toBeDefined();
      expect(logRepo.find).toHaveBeenCalled();
    });

    test('rejects a non-snowflake userId filter', async () => {
      await expect(route('GET /bait-channel/logs')('g1', {}, '/x?userId=not-a-snowflake')).rejects.toThrow();
    });
  });

  describe('GET /bait-channel/raid-mode/status', () => {
    test('returns the inactive default when no raid-mode manager is initialized', async () => {
      const res = await route('GET /bait-channel/raid-mode/status')('g1', {}, '');
      expect(res).toEqual({ active: false, until: null, triggerCount: 0, recentOffenderIds: [] });
    });
  });
});
