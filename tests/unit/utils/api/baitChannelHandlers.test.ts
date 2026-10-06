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

import { afterAll, beforeAll, beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { AuditLog } from '../../../../src/typeorm/entities/AuditLog';
import { BaitChannelConfig } from '../../../../src/typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../../../../src/typeorm/entities/bait/BaitChannelLog';
import { PendingAction } from '../../../../src/typeorm/entities/bait/PendingAction';
import { registerBaitChannelHandlers } from '../../../../src/utils/api/handlers/baitChannelHandlers';
import { AppDataSource } from '../../../../src/typeorm';

type RouteHandler = (guildId: string, body: any, url: string) => Promise<any>;

// auditHelper is mock.module'd (Bun hoists this above the SUT import) so this
// test does not depend on suite-wide module-load order to get the real
// writeAuditLog — matching the sibling api-handler tests (ticket/application/
// setup), which all mock it. mock.module is process-shared, so we provide BOTH
// auditHelper exports as fakes to avoid undefined unmocked exports elsewhere.
const fakeWriteAuditLog = jest.fn(async () => undefined);
const fakeWriteAuditAction = jest.fn(async () => undefined);
mock.module('../../../../src/utils/api/handlers/auditHelper', () => ({
  writeAuditLog: fakeWriteAuditLog,
  writeAuditAction: fakeWriteAuditAction,
}));

const state: { config: any; pending: any[]; logs: any[] } = { config: null, pending: [], logs: [] };

const configRepo = {
  findOne: jest.fn(async () => state.config),
  save: jest.fn(async (x: any) => x),
};
const pendingRepo = {
  find: jest.fn(async () => state.pending),
  findOne: jest.fn(async (): Promise<any> => null),
  remove: jest.fn(async (x: any) => x),
};
const logRepo = { find: jest.fn(async () => state.logs) };
const auditRepo = { create: jest.fn((x: any) => x), save: jest.fn(async (x: any) => x) };

// Handlers read `client.baitChannelManager` per request, so tests can attach one.
const client = { guilds: { fetch: jest.fn(async () => null) } } as any;

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
  pendingRepo.findOne.mockReset();
  pendingRepo.remove.mockClear();
  client.baitChannelManager = undefined;
  logRepo.find.mockClear();
  auditRepo.save.mockClear();
  fakeWriteAuditLog.mockClear();
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
      expect(fakeWriteAuditLog).toHaveBeenCalled(); // writeAuditLog (mocked, order-independent)
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

    // #25: values that would make every bait action fail at action time.
    test.each([
      ['deleteMessageHours', 200], // Discord caps ban message deletion at 7 days
      ['timeoutDurationMinutes', 50000], // Discord caps timeouts at 28 days
      ['timeoutDurationMinutes', 0],
      ['gracePeriodSeconds', -1],
      ['instantActionThreshold', 101],
      ['escalationBanThreshold', -5],
      ['minMessageCount', 1.5], // INT column
    ])('rejects %s = %p and saves nothing', async (field, value) => {
      state.config = { guildId: 'g1', [field]: 10 };
      await expect(route('POST /bait-channel/config/update')('g1', { [field]: value }, '')).rejects.toThrow();
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    test('rejects a channel or role ID that is not a snowflake', async () => {
      state.config = { guildId: 'g1' };
      for (const field of ['logChannelId', 'summaryChannelId', 'raidModeAlertRoleId']) {
        await expect(route('POST /bait-channel/config/update')('g1', { [field]: 'general' }, '')).rejects.toThrow(
          `${field} must be a valid Discord ID`,
        );
      }
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    test('accepts in-range values, a valid snowflake, and null to clear an ID', async () => {
      state.config = { guildId: 'g1', summaryChannelId: '123456789012345678' };
      const res = await route('POST /bait-channel/config/update')(
        'g1',
        {
          deleteMessageHours: 168,
          timeoutDurationMinutes: 40320,
          logChannelId: '223456789012345678',
          summaryChannelId: null,
        },
        '',
      );
      expect(res.success).toBe(true);
      expect(state.config.logChannelId).toBe('223456789012345678');
      expect(state.config.summaryChannelId).toBe(null);
      expect(configRepo.save).toHaveBeenCalledTimes(1);
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

  describe('POST /bait-channel/pending-actions/cancel', () => {
    const row = { id: 7, guildId: 'g1', userId: 'u1', messageId: 'm1', action: 'ban', attempts: 0 };

    test('stops the grace timer before deleting the row', async () => {
      pendingRepo.findOne.mockResolvedValue({ ...row });
      const order: string[] = [];
      const cancelPendingAction = jest.fn(async () => {
        order.push('timer');
        return true;
      });
      pendingRepo.remove.mockImplementation(async (x: any) => {
        order.push('row');
        return x;
      });
      client.baitChannelManager = { cancelPendingAction };

      const res = await route('POST /bait-channel/pending-actions/cancel')('g1', { id: 7 }, '');

      expect(res).toEqual({ success: true });
      expect(cancelPendingAction).toHaveBeenCalledWith('g1', 'u1', 'm1');
      expect(order).toEqual(['timer', 'row']);
      expect(fakeWriteAuditLog).toHaveBeenCalled();
    });

    test('still removes the row when no manager is attached (retry rows only live in the DB)', async () => {
      pendingRepo.findOne.mockResolvedValue({ ...row, attempts: 2 });
      await route('POST /bait-channel/pending-actions/cancel')('g1', { id: 7 }, '');
      expect(pendingRepo.remove).toHaveBeenCalledTimes(1);
    });

    test('404 when the row is not in this guild', async () => {
      pendingRepo.findOne.mockResolvedValue(null);
      await expect(route('POST /bait-channel/pending-actions/cancel')('g1', { id: 7 }, '')).rejects.toThrow();
      expect(pendingRepo.remove).not.toHaveBeenCalled();
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
