/**
 * setupHandlers API Behavioral Tests
 *
 * Exercises POST /setup/toggle and POST /setup/systems.
 * Same mocking strategy as ticket/applicationHandlers tests.
 *
 * Coverage:
 *   - toggle: enable adds system to selectedSystems, disable removes it,
 *     unsetting the last difference returns null (= "all enabled")
 *   - toggle: creates SetupState with detected DB defaults if none exists
 *   - systems: replaces selectedSystems on existing state
 *   - systems: creates SetupState if none exists
 *   - audit log fired for both endpoints with triggeredBy
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
import type { Client } from "discord.js";

const fakeWriteAuditLog = jest.fn(async () => undefined);
mock.module("../../../../src/utils/api/handlers/auditHelper", () => ({
  writeAuditLog: fakeWriteAuditLog,
}));

interface SetupRepoState {
  findOneByResult: any;
  saved: any[];
  created: any[];
}

const setupStateRepoState: SetupRepoState = {
  findOneByResult: null,
  saved: [],
  created: [],
};

// Snapshot calls (clone) so later mutations to the same state object don't
// leak into earlier captures — the SUT mutates `state.selectedSystems` after
// the initial create+save and saves again, sharing the same reference.
const setupStateRepo = {
  findOneBy: jest.fn(async () => setupStateRepoState.findOneByResult),
  create: jest.fn((data: any) => {
    setupStateRepoState.created.push({ ...data });
    return data;
  }),
  save: jest.fn(async (entity: any) => {
    setupStateRepoState.saved.push({
      ...entity,
      selectedSystems: Array.isArray(entity.selectedSystems)
        ? [...entity.selectedSystems]
        : entity.selectedSystems,
    });
    return entity;
  }),
};

// detectSystemStates queries 10 entity repos. We don't care about their
// individual results for toggle tests — return null for findOneBy, 0 for count,
// which produces an all-not_started default.
const nullRepo = {
  findOneBy: jest.fn(async () => null),
  count: jest.fn(async () => 0),
};

let registerSetupHandlers: typeof import("../../../../src/utils/api/handlers/setupHandlers").registerSetupHandlers;
let routes: Map<string, any>;
const fakeClient = {} as Client;

beforeAll(async () => {
  const { AppDataSource } = await import("../../../../src/typeorm");
  const { SetupState } = await import(
    "../../../../src/typeorm/entities/SetupState"
  );
  // Patch getRepository: SetupState gets the stateful fake; everything else
  // gets the null/zero fake (used by detectSystemStates).
  (
    AppDataSource as unknown as { getRepository: (e: unknown) => unknown }
  ).getRepository = (entity) =>
    entity === SetupState ? setupStateRepo : nullRepo;
  const sut = await import("../../../../src/utils/api/handlers/setupHandlers");
  registerSetupHandlers = sut.registerSetupHandlers;
});

beforeEach(() => {
  setupStateRepoState.findOneByResult = null;
  setupStateRepoState.saved = [];
  setupStateRepoState.created = [];
  setupStateRepo.findOneBy.mockClear();
  setupStateRepo.create.mockClear();
  setupStateRepo.save.mockClear();
  nullRepo.findOneBy.mockClear();
  nullRepo.count.mockClear();
  fakeWriteAuditLog.mockClear();

  routes = new Map();
  registerSetupHandlers(fakeClient, routes);
});

afterEach(() => {
  jest.clearAllMocks();
});

function getRoute(path: string) {
  const handler = routes.get(path);
  if (!handler) throw new Error(`${path} not registered`);
  return handler;
}

const ALL_SYSTEMS = [
  "staffRole",
  "ticket",
  "application",
  "announcement",
  "baitchannel",
  "memory",
  "rules",
  "reactionRole",
];

// ---------------------------------------------------------------------------
// POST /setup/toggle
// ---------------------------------------------------------------------------

describe("POST /setup/toggle", () => {
  test("disabling one system on an existing all-enabled state writes the remaining set", async () => {
    setupStateRepoState.findOneByResult = {
      guildId: "guild-1",
      selectedSystems: null, // null = all enabled
      systemStates: {},
      partialData: null,
    };

    const result = await getRoute("POST /setup/toggle")(
      "guild-1",
      { systemId: "baitchannel", enabled: false, triggeredBy: "admin-1" },
      "/setup/toggle",
    );

    expect(result).toEqual({
      success: true,
      guildId: "guild-1",
      systemId: "baitchannel",
      enabled: false,
      selectedSystems: ALL_SYSTEMS.filter((s) => s !== "baitchannel"),
    });
    expect(setupStateRepoState.saved).toHaveLength(1);
    expect(setupStateRepoState.saved[0].selectedSystems).toEqual(
      ALL_SYSTEMS.filter((s) => s !== "baitchannel"),
    );
    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "setup.toggle",
      "admin-1",
      {
        systemId: "baitchannel",
        enabled: false,
      },
    );
  });

  test("enabling a previously-disabled system: selectedSystems set converges to all → returned as null", async () => {
    setupStateRepoState.findOneByResult = {
      guildId: "guild-1",
      // Currently all systems EXCEPT baitchannel
      selectedSystems: ALL_SYSTEMS.filter((s) => s !== "baitchannel"),
      systemStates: {},
      partialData: null,
    };

    const result = await getRoute("POST /setup/toggle")(
      "guild-1",
      { systemId: "baitchannel", enabled: true },
      "/setup/toggle",
    );

    // When the enabled set covers everything, the handler stores null (= "no opt-out")
    expect(result.selectedSystems).toBeNull();
    expect(setupStateRepoState.saved[0].selectedSystems).toBeNull();
  });

  test("disabling a system that is not currently enabled: no change to the set", async () => {
    setupStateRepoState.findOneByResult = {
      guildId: "guild-1",
      selectedSystems: ["ticket", "application"],
      systemStates: {},
      partialData: null,
    };

    const result = await getRoute("POST /setup/toggle")(
      "guild-1",
      { systemId: "baitchannel", enabled: false },
      "/setup/toggle",
    );

    expect(result.selectedSystems).toEqual(["ticket", "application"]);
  });

  test("creates SetupState with detected DB defaults when none exists, then applies the toggle", async () => {
    setupStateRepoState.findOneByResult = null;

    await getRoute("POST /setup/toggle")(
      "guild-1",
      { systemId: "memory", enabled: false },
      "/setup/toggle",
    );

    // detectSystemStates fired (10 entity lookups against the null repo)
    expect(nullRepo.findOneBy).toHaveBeenCalled();
    expect(nullRepo.count).toHaveBeenCalled();
    // Created the new state row, then saved it twice (once on create, once after toggle)
    expect(setupStateRepoState.created).toHaveLength(1);
    expect(setupStateRepoState.created[0]).toMatchObject({
      guildId: "guild-1",
      selectedSystems: null,
    });
    expect(setupStateRepoState.saved.length).toBeGreaterThanOrEqual(2);
    // Final saved state has memory removed from the all-systems set
    const finalSave =
      setupStateRepoState.saved[setupStateRepoState.saved.length - 1];
    expect(finalSave.selectedSystems).toEqual(
      ALL_SYSTEMS.filter((s) => s !== "memory"),
    );
  });

  test("rejects body missing systemId or enabled (helper validation)", async () => {
    setupStateRepoState.findOneByResult = {
      guildId: "guild-1",
      selectedSystems: null,
      systemStates: {},
      partialData: null,
    };

    await expect(
      getRoute("POST /setup/toggle")(
        "guild-1",
        { systemId: "baitchannel" },
        "/setup/toggle",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      getRoute("POST /setup/toggle")(
        "guild-1",
        { enabled: false },
        "/setup/toggle",
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ---------------------------------------------------------------------------
// POST /setup/systems
// ---------------------------------------------------------------------------

describe("POST /setup/systems", () => {
  test("updates existing state with the provided enabledSystems list", async () => {
    setupStateRepoState.findOneByResult = {
      guildId: "guild-1",
      selectedSystems: ["ticket"],
      systemStates: {},
      partialData: null,
    };

    const result = await getRoute("POST /setup/systems")(
      "guild-1",
      { enabledSystems: ["ticket", "application"], triggeredBy: "admin-1" },
      "/setup/systems",
    );

    expect(result).toEqual({
      success: true,
      guildId: "guild-1",
      selectedSystems: ["ticket", "application"],
    });
    expect(setupStateRepoState.saved[0].selectedSystems).toEqual([
      "ticket",
      "application",
    ]);
    expect(fakeWriteAuditLog).toHaveBeenCalledWith(
      "guild-1",
      "setup.systems",
      "admin-1",
      {
        enabledSystems: ["ticket", "application"],
      },
    );
  });

  test("creates SetupState with detected DB defaults when none exists", async () => {
    setupStateRepoState.findOneByResult = null;

    await getRoute("POST /setup/systems")(
      "guild-1",
      { enabledSystems: ["ticket"] },
      "/setup/systems",
    );

    expect(setupStateRepoState.created).toHaveLength(1);
    expect(setupStateRepoState.created[0]).toMatchObject({
      guildId: "guild-1",
      selectedSystems: ["ticket"],
    });
    expect(setupStateRepoState.saved).toHaveLength(1);
  });

  test("omitted enabledSystems → selectedSystems persisted as null", async () => {
    setupStateRepoState.findOneByResult = {
      guildId: "guild-1",
      selectedSystems: ["ticket"],
      systemStates: {},
      partialData: null,
    };

    const result = await getRoute("POST /setup/systems")(
      "guild-1",
      {},
      "/setup/systems",
    );

    expect(result.selectedSystems).toBeNull();
    expect(setupStateRepoState.saved[0].selectedSystems).toBeNull();
  });
});
