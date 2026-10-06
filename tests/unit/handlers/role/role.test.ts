/**
 * /role add · remove · list — one staff-role format (v3.16.11 regression).
 *
 * staff_roles.role used to hold two formats: `/role add` stored Role.toString()
 * (`<@&id>`) while the dashboard stored the raw snowflake, so neither side
 * matched the other. These tests pin: `/role add` writes the raw ID and
 * rejects @everyone; the duplicate check and `/role remove` match both stored
 * formats; `/role remove` no longer reports success when the role is saved
 * under the other type; `/role list` renders every row as a mention.
 *
 * Strategy: patch AppDataSource.getRepository (same seam as roleDelete.test.ts)
 * with one fake StaffRole repo whose rows are reset per test — the handlers'
 * lazyRepo caches the first repo it sees, so the object must stay the same.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { FindOperator } from 'typeorm';
import rolesLang from '../../../../src/lang/en/roles.json';

const RAW = '123456789012345678';
const OTHER = '223456789012345678';
const GUILD = '999999999999999999';

type Row = { id: number; guildId: string; type: string; role: string; alias: string };

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const value = (row as Record<string, unknown>)[k];
    if (v instanceof FindOperator) return v.type === 'in' && (v.value as unknown[]).includes(value);
    return value === v;
  });
}

const store = { rows: [] as Row[], nextId: 1 };

const fakeStaffRoleRepo = {
  async findOneBy(where: Record<string, unknown>) {
    return store.rows.find(r => matches(r, where)) ?? null;
  },
  async find(opts: { where: Record<string, unknown> }) {
    return store.rows.filter(r => matches(r, opts.where));
  },
  async remove(rows: Row[]) {
    const ids = new Set(rows.map(r => r.id));
    store.rows = store.rows.filter(r => !ids.has(r.id));
    return rows;
  },
  createQueryBuilder() {
    let guildId: string | undefined;
    const builder: any = {
      insert: () => builder,
      values: (values: Omit<Row, 'id'>[]) => {
        builder.pending = values;
        return builder;
      },
      async execute() {
        for (const v of builder.pending ?? []) store.rows.push({ id: store.nextId++, ...v });
      },
      select: () => builder,
      addSelect: () => builder,
      where: (_clause: string, params: { guildId: string }) => {
        guildId = params.guildId;
        return builder;
      },
      async getRawMany() {
        return store.rows.filter(r => r.guildId === guildId);
      },
    };
    return builder;
  },
};

let roleAddHandler: typeof import('../../../../src/commands/handlers/role').roleAddHandler;
let roleRemoveHandler: typeof import('../../../../src/commands/handlers/role').roleRemoveHandler;
let roleListHandler: typeof import('../../../../src/commands/handlers/role').roleListHandler;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    if (entity?.name !== 'StaffRole') throw new Error(`role test: unexpected repo ${entity?.name}`);
    return fakeStaffRoleRepo;
  };
  ({ roleAddHandler, roleRemoveHandler, roleListHandler } = await import('../../../../src/commands/handlers/role'));
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

let userCounter = 0;

/** Fake slash interaction; a fresh user per call keeps the ROLE_SAVE rate limit out of the way. */
function makeInteraction(opts: { sub?: string; roleId?: string; alias?: string }) {
  const replies: string[] = [];
  const roleId = opts.roleId ?? RAW;
  const interaction = {
    isRepliable: () => true,
    guild: { id: GUILD },
    guildId: GUILD,
    member: { permissions: { has: () => true } },
    user: { id: `user-${++userCounter}`, tag: 'tester' },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => opts.sub ?? 'staff',
      // Mirrors discord.js Role.toString(): the guild's own role renders as "@everyone".
      getRole: () => ({ id: roleId, toString: () => (roleId === GUILD ? '@everyone' : `<@&${roleId}>`) }),
      getString: () => opts.alias ?? null,
    },
    reply: async (payload: { content: string }) => {
      replies.push(payload.content);
    },
  } as never;
  return { interaction, replies };
}

function seed(rows: Array<Omit<Row, 'id' | 'guildId' | 'alias'> & { alias?: string; guildId?: string }>) {
  for (const r of rows) store.rows.push({ id: store.nextId++, guildId: GUILD, alias: 'Alias', ...r });
}

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
});

describe('/role add', () => {
  test('stores the raw snowflake, not the <@&id> mention', async () => {
    const { interaction, replies } = makeInteraction({ sub: 'staff', alias: 'Support' });
    await roleAddHandler(interaction);

    expect(store.rows).toEqual([{ id: 1, guildId: GUILD, type: 'staff', role: RAW, alias: 'Support' }]);
    expect(replies).toEqual([rolesLang.addRole.successStaff]);
  });

  test('a role saved in the legacy <@&id> format counts as already saved', async () => {
    seed([{ type: 'staff', role: `<@&${RAW}>` }]);
    const { interaction, replies } = makeInteraction({ sub: 'admin' });
    await roleAddHandler(interaction);

    expect(store.rows).toHaveLength(1);
    expect(replies[0]).toContain(rolesLang.addRole.alreadyAdded);
  });

  test('a dashboard-saved raw ID counts as already saved', async () => {
    seed([{ type: 'staff', role: RAW }]);
    const { interaction, replies } = makeInteraction({ sub: 'staff' });
    await roleAddHandler(interaction);

    expect(store.rows).toHaveLength(1);
    expect(replies[0]).toContain(rolesLang.addRole.alreadyAdded);
  });

  test('rejects @everyone instead of saving the guild ID (or the literal "@everyone")', async () => {
    const { interaction, replies } = makeInteraction({ sub: 'staff', roleId: GUILD });
    await roleAddHandler(interaction);

    expect(store.rows).toHaveLength(0);
    expect(replies[0]).toContain('@everyone');
  });
});

describe('/role remove', () => {
  test('removes a dashboard-saved raw ID row', async () => {
    seed([{ type: 'staff', role: RAW }]);
    const { interaction, replies } = makeInteraction({ sub: 'staff' });
    await roleRemoveHandler(interaction);

    expect(store.rows).toHaveLength(0);
    expect(replies).toEqual([rolesLang.removeRole.successStaff]);
  });

  test('removes a legacy <@&id> row (and a raw duplicate of it)', async () => {
    seed([
      { type: 'admin', role: `<@&${RAW}>` },
      { type: 'admin', role: RAW },
      { type: 'admin', role: OTHER },
    ]);
    const { interaction, replies } = makeInteraction({ sub: 'admin' });
    await roleRemoveHandler(interaction);

    expect(store.rows.map(r => r.role)).toEqual([OTHER]);
    expect(replies).toEqual([rolesLang.removeRole.successAdmin]);
  });

  test('role saved under the other type → "not found", nothing removed, no false success', async () => {
    // The #104 scenario: @Mods saved as admin, some other staff role exists.
    seed([
      { type: 'admin', role: `<@&${RAW}>` },
      { type: 'staff', role: OTHER },
    ]);
    const { interaction, replies } = makeInteraction({ sub: 'staff' });
    await roleRemoveHandler(interaction);

    expect(store.rows).toHaveLength(2);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain(rolesLang.removeRole.dne);
    expect(replies[0]).not.toContain(rolesLang.removeRole.successStaff);
  });

  test('no saved roles of that type → noType', async () => {
    seed([{ type: 'admin', role: RAW }]);
    const { interaction, replies } = makeInteraction({ sub: 'staff', roleId: OTHER });
    await roleRemoveHandler(interaction);

    expect(store.rows).toHaveLength(1);
    expect(replies[0]).toContain(rolesLang.removeRole.noType);
  });
});

describe('/role list', () => {
  test('renders raw and legacy rows alike as role mentions', async () => {
    seed([
      { type: 'staff', role: RAW, alias: 'Support' },
      { type: 'admin', role: `<@&${OTHER}>`, alias: 'Mods' },
    ]);
    const { interaction, replies } = makeInteraction({});
    await roleListHandler(interaction);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain(`* Support - <@&${RAW}>`);
    expect(replies[0]).toContain(`* Mods - <@&${OTHER}>`);
  });
});
