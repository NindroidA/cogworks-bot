/**
 * StatusManager.autoSetStatus (NindroidA/cogworks-bot#41, findings #136, #137).
 *
 * - #137: the only trigger for 'major-outage' is a database outage, and
 *   autoSetStatus read and saved the status row first, so it threw and the
 *   presence never changed. Now the presence changes from memory and nothing is
 *   saved; once the database is back the presence recovers even though the
 *   outage level was never stored.
 * - #136: an expired manual override was only reverted on a degraded→healthy
 *   flip. The health loop now calls autoSetStatus('operational') on every
 *   healthy tick, and autoSetStatus clears the expired override.
 *
 * Patches AppDataSource.getRepository for BotStatus / StatusIncident (restored in afterAll).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { AppDataSource } from '../../../src/typeorm';
import { healthMonitor } from '../../../src/utils/monitoring/healthMonitor';
import { StatusManager } from '../../../src/utils/status/statusManager';

type GetRepository = (entity: unknown) => unknown;

let row: Record<string, any> | null = null;
let dbDown = false;
let saves = 0;
let openIncidents: Array<Record<string, any>> = [];

const statusRepo = {
  async findOneBy() {
    if (dbDown) throw new Error('connect ECONNREFUSED');
    return row;
  },
  create: (data: Record<string, unknown>) => ({ ...data }),
  async save(entity: Record<string, any>) {
    if (dbDown) throw new Error('connect ECONNREFUSED');
    saves++;
    row = entity;
    return entity;
  },
};
const incidentRepo = {
  create: (data: Record<string, unknown>) => ({ ...data }),
  async save(entity: any) {
    if (!Array.isArray(entity)) openIncidents.push(entity);
    return entity;
  },
  async find() {
    return openIncidents.filter(i => !i.resolvedAt);
  },
};

let original: GetRepository;
beforeAll(() => {
  const ds = AppDataSource as unknown as { getRepository: GetRepository };
  original = ds.getRepository;
  ds.getRepository = (entity: any) => {
    if (entity?.name === 'BotStatus') return statusRepo;
    if (entity?.name === 'StatusIncident') return incidentRepo;
    throw new Error(`statusManager test: no fake repo for ${entity?.name}`);
  };
});
afterAll(() => {
  (AppDataSource as unknown as { getRepository: GetRepository }).getRepository = original;
});

const operationalRow = () => ({
  id: 1,
  level: 'operational',
  message: null,
  affectedSystems: null,
  startedAt: null,
  isManualOverride: false,
  manualOverrideExpiresAt: null,
});

function makeManager() {
  const setPresence = jest.fn();
  const client = { user: { setPresence }, channels: { fetch: async () => null } } as any;
  return { manager: new StatusManager(client, false), lastPresence: () => setPresence.mock.calls.at(-1)?.[0]?.status };
}

beforeEach(() => {
  row = operationalRow();
  dbDown = false;
  saves = 0;
  openIncidents = [];
});

describe('autoSetStatus during a database outage (#137)', () => {
  test('sets the major-outage presence without touching the database, then recovers', async () => {
    const { manager, lastPresence } = makeManager();
    await manager.updatePresence(); // startup: presence from the row
    expect(lastPresence()).toBe('online');

    dbDown = true;
    await manager.autoSetStatus('major-outage');
    expect(lastPresence()).toBe('dnd');
    expect(saves).toBe(0);

    // Still down on the next tick: no repeat presence update needed, no throw
    await expect(manager.autoSetStatus('major-outage')).resolves.toBeUndefined();

    // Database back: the row still says operational (the outage was never saved)
    dbDown = false;
    await manager.autoSetStatus('operational');
    expect(lastPresence()).toBe('online');
  });

  test('an active manual override still wins while the database is down', async () => {
    row = { ...operationalRow(), level: 'maintenance', isManualOverride: true, manualOverrideExpiresAt: new Date(Date.now() + 60_000) };
    const { manager, lastPresence } = makeManager();
    await manager.updatePresence();
    const before = lastPresence();

    dbDown = true;
    await manager.autoSetStatus('major-outage');
    expect(lastPresence()).toBe(before);
  });
});

describe('expired manual override (#136)', () => {
  test('a healthy tick reverts it to operational and clears the expiry', async () => {
    row = {
      ...operationalRow(),
      level: 'maintenance',
      message: 'DB migration',
      startedAt: new Date(Date.now() - 3 * 86_400_000),
      isManualOverride: true,
      manualOverrideExpiresAt: new Date(Date.now() - 1000),
    };
    openIncidents = [{ level: 'maintenance', message: 'DB migration', resolvedAt: null }];
    const { manager, lastPresence } = makeManager();
    await manager.updatePresence();
    expect(lastPresence()).toBe('idle');

    await manager.autoSetStatus('operational');

    expect(row).toMatchObject({ level: 'operational', isManualOverride: false, manualOverrideExpiresAt: null });
    expect(lastPresence()).toBe('online');
    expect(openIncidents[0].resolvedAt).toBeInstanceOf(Date);
  });

  test('an override that has not expired is left alone', async () => {
    row = { ...operationalRow(), level: 'maintenance', isManualOverride: true, manualOverrideExpiresAt: new Date(Date.now() + 60_000) };
    const { manager } = makeManager();

    await manager.autoSetStatus('operational');

    expect(row?.level).toBe('maintenance');
    expect(saves).toBe(0);
  });

  test('a steady healthy tick saves nothing', async () => {
    const { manager } = makeManager();
    await manager.updatePresence();

    await manager.autoSetStatus('operational');
    expect(saves).toBe(0);
  });
});

describe('health loop', () => {
  const healthy = { status: 'healthy', activeGuilds: 1, memory: { heapUsedMB: '1' }, database: { connected: true }, errors: { errorRate: 0 } };
  let spy: ReturnType<typeof jest.spyOn>;
  afterEach(() => {
    spy?.mockRestore();
    (healthMonitor as any).statusManager = undefined;
  });

  test('calls autoSetStatus on every healthy tick, not only after a recovery', async () => {
    const autoSetStatus = jest.fn(async () => undefined);
    healthMonitor.setStatusManager({ autoSetStatus } as any);
    spy = jest.spyOn(healthMonitor, 'getHealthStatus').mockResolvedValue(healthy as any);

    await healthMonitor.logHealthStatus();
    await healthMonitor.logHealthStatus();

    expect(autoSetStatus.mock.calls).toEqual([['operational'], ['operational']] as any);
  });
});
