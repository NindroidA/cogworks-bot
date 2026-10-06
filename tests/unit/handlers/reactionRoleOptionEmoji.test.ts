/**
 * Reaction-role option emoji identity in the command and dashboard paths.
 *
 * The reaction lookup keys custom emoji by id, so `<:x:id>`, `<a:x:id>` and a
 * renamed `<:y:id>` are one option there. `/reactionrole add`, `/reactionrole
 * remove` and the dashboard create route must use the same identity, or two
 * spellings of one emoji become colliding options and one role can never be
 * granted.
 *
 * Uses the AppDataSource.getRepository runtime-patch pattern (lazyRepo caches
 * the first repo it resolves, so state is reset in place).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { lang } from '../../../src/lang';
import { AppDataSource } from '../../../src/typeorm';

const tl = lang.reactionRole;

const EMOJI_ID = '700000000000000001';
const OTHER_EMOJI_ID = '700000000000000002';
const ROLE_A = '600000000000000001';
const ROLE_B = '600000000000000002';

// ---------------------------------------------------------------------------
// Fake repos
// ---------------------------------------------------------------------------

const state = {
  menu: null as Record<string, any> | null,
  saved: [] as Array<Record<string, any>>,
  removed: [] as Array<Record<string, any>>,
};

const fakeMenuRepo = {
  findOneCalls: 0,
  async findOne() {
    fakeMenuRepo.findOneCalls++;
    // Only the first lookup returns the menu; the reload after a change returns
    // null so the handlers skip updateMenuMessage (Discord I/O)
    return fakeMenuRepo.findOneCalls === 1 ? state.menu : null;
  },
  create(data: Record<string, unknown>) {
    return { ...data };
  },
  menuCount: 0,
  async count() {
    return fakeMenuRepo.menuCount;
  },
};

const fakeOptionRepo = {
  create(data: Record<string, unknown>) {
    return { ...data };
  },
  async save(entity: Record<string, any>) {
    state.saved.push(entity);
    return entity;
  },
  async remove(entity: Record<string, any>) {
    state.removed.push(entity);
    return entity;
  },
};

let guildSeq = 0;
let guildId = '';

function setMenu(options: Array<{ id: number; emoji: string; roleId: string }>) {
  state.menu = { id: 1, guildId, messageId: '300000000000000001', name: 'Colors', mode: 'normal', options };
}

function makeInteraction(strings: Record<string, string>, roleId = ROLE_B) {
  return {
    guildId,
    guild: {
      id: guildId,
      // Past the duplicate check: fail here so the test needs no role hierarchy
      members: { fetchMe: jest.fn(async () => Promise.reject(new Error('stop after the duplicate check'))) },
    },
    user: { id: '500000000000000001' },
    member: { permissions: { has: () => true } },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    options: {
      getString: (name: string) => strings[name] ?? null,
      getRole: () => ({ id: roleId }),
    },
    reply: jest.fn(async () => undefined),
  } as any;
}

function replyText(interaction: { reply: { mock: { calls: any[][] } } }): string {
  return interaction.reply.mock.calls[0]?.[0]?.content ?? '';
}

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

let addHandler: typeof import('../../../src/commands/handlers/reactionRole/add').reactionRoleAddHandler;
let removeHandler: typeof import('../../../src/commands/handlers/reactionRole/remove').reactionRoleRemoveHandler;
let registerApi: typeof import('../../../src/utils/api/handlers/reactionRoleHandlers').registerReactionRoleHandlers;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    if (entity?.name === 'ReactionRoleMenu') return fakeMenuRepo;
    if (entity?.name === 'ReactionRoleOption') return fakeOptionRepo;
    throw new Error(`reactionRole option test: no fake repo for ${entity?.name}`);
  };
  ({ reactionRoleAddHandler: addHandler } = await import('../../../src/commands/handlers/reactionRole/add'));
  ({ reactionRoleRemoveHandler: removeHandler } = await import('../../../src/commands/handlers/reactionRole/remove'));
  ({ registerReactionRoleHandlers: registerApi } = await import(
    '../../../src/utils/api/handlers/reactionRoleHandlers'
  ));
});

afterAll(() => {
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  // A fresh guild per test keeps the per-guild command rate limit out of the way
  guildSeq++;
  guildId = `1000000000000${String(guildSeq).padStart(5, '0')}`;
  state.menu = null;
  state.saved = [];
  state.removed = [];
  fakeMenuRepo.findOneCalls = 0;
  fakeMenuRepo.menuCount = 0;
});

// ---------------------------------------------------------------------------
// /reactionrole add
// ---------------------------------------------------------------------------

describe('/reactionrole add duplicate emoji', () => {
  test.each([
    ['the animated spelling', `<a:blob:${EMOJI_ID}>`],
    ['a renamed spelling', `<:newname:${EMOJI_ID}>`],
  ])('rejects %s of a custom emoji already on the menu', async (_label, emoji) => {
    setMenu([{ id: 1, emoji: `<:blob:${EMOJI_ID}>`, roleId: ROLE_A }]);
    const interaction = makeInteraction({ menu: '1', emoji });

    await addHandler(interaction);

    expect(replyText(interaction)).toContain(tl.add.duplicateEmoji);
    expect(interaction.guild.members.fetchMe).not.toHaveBeenCalled();
    expect(state.saved).toHaveLength(0);
  });

  test('a different custom emoji with the same name is not a duplicate', async () => {
    setMenu([{ id: 1, emoji: `<:blob:${EMOJI_ID}>`, roleId: ROLE_A }]);
    const interaction = makeInteraction({ menu: '1', emoji: `<:blob:${OTHER_EMOJI_ID}>` });

    await addHandler(interaction);

    expect(replyText(interaction)).not.toContain(tl.add.duplicateEmoji);
    expect(interaction.guild.members.fetchMe).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// /reactionrole remove
// ---------------------------------------------------------------------------

describe('/reactionrole remove', () => {
  test('finds a custom emoji option by id, whatever spelling is typed', async () => {
    setMenu([
      { id: 1, emoji: '🔴', roleId: ROLE_A },
      { id: 2, emoji: `<:oldname:${EMOJI_ID}>`, roleId: ROLE_B },
    ]);
    const interaction = makeInteraction({ menu: '1', emoji: `<a:newname:${EMOJI_ID}>` });

    await removeHandler(interaction);

    expect(state.removed.map(o => o.id)).toEqual([2]);
    expect(replyText(interaction)).not.toContain(tl.remove.notFound);
  });

  test('an emoji that is not on the menu is still not found', async () => {
    setMenu([{ id: 1, emoji: `<:blob:${EMOJI_ID}>`, roleId: ROLE_A }]);
    const interaction = makeInteraction({ menu: '1', emoji: `<:blob:${OTHER_EMOJI_ID}>` });

    await removeHandler(interaction);

    expect(state.removed).toHaveLength(0);
    expect(replyText(interaction)).toContain(tl.remove.notFound);
  });
});

// ---------------------------------------------------------------------------
// Dashboard create (POST /reaction-roles)
// ---------------------------------------------------------------------------

function dashboardCreate(roles: Array<{ id: string; managed: boolean; position: number }> = []) {
  const send = jest.fn(async () => ({ id: '300000000000000009', react: jest.fn(), delete: jest.fn() }));
  const channel = { isTextBased: () => true, send };
  const roleCache = new Map<string, unknown>([[ROLE_A, { id: ROLE_A, managed: false, position: 1 }]]);
  for (const role of roles) roleCache.set(role.id, role);
  const client = {
    guilds: {
      cache: new Map([
        [
          guildId,
          {
            id: guildId,
            channels: { fetch: async () => channel },
            members: { fetchMe: async () => ({ roles: { highest: { position: 10 } } }) },
            roles: { cache: roleCache },
          },
        ],
      ]),
    },
  } as any;
  const routes = new Map<string, any>();
  registerApi(client, routes);
  const create = (options: Array<{ emoji: string; roleId: string }>) =>
    routes.get('POST /reaction-roles')(guildId, { channelId: '200000000000000001', title: 'Colors', options });
  return { create, send };
}

describe('dashboard menu create limits and role checks (same as the slash commands)', () => {
  test('more than 20 options is a 400 before sending', async () => {
    const { create, send } = dashboardCreate();
    const options = Array.from({ length: 21 }, () => ({ emoji: '✅', roleId: ROLE_A }));
    await expect(create(options)).rejects.toMatchObject({ statusCode: 400, message: tl.add.maxOptions });
    expect(send).not.toHaveBeenCalled();
  });

  test('a 26th menu is a 400 before sending', async () => {
    fakeMenuRepo.menuCount = 25;
    const { create, send } = dashboardCreate();
    await expect(create([{ emoji: '✅', roleId: ROLE_A }])).rejects.toMatchObject({
      statusCode: 400,
      message: tl.create.maxMenus,
    });
    expect(send).not.toHaveBeenCalled();
  });

  test.each([
    ['an invalid emoji', { emoji: 'nope', roleId: ROLE_A }, [], tl.add.invalidEmoji],
    ['a role not in the guild', { emoji: '✅', roleId: ROLE_B }, [], 'role not found'],
    ['a managed role', { emoji: '✅', roleId: ROLE_B }, [{ id: ROLE_B, managed: true, position: 1 }], tl.add.cannotUseManagedRole],
    ['a role above the bot', { emoji: '✅', roleId: ROLE_B }, [{ id: ROLE_B, managed: false, position: 10 }], tl.add.roleTooHigh],
  ] as const)('%s is a 400 before sending', async (_label, option, roles, message) => {
    const { create, send } = dashboardCreate([...roles]);
    const error = await create([option]).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 400 });
    expect(String((error as Error).message)).toContain(message);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('dashboard menu create', () => {
  test('rejects two spellings of one custom emoji before sending anything', async () => {
    const send = jest.fn(async () => ({ id: '300000000000000009', react: jest.fn(), delete: jest.fn() }));
    const channel = { isTextBased: () => true, send };
    const client = {
      guilds: {
        cache: new Map([
          [
            guildId,
            {
              id: guildId,
              channels: { fetch: async () => channel },
              members: { fetchMe: async () => ({ roles: { highest: { position: 10 } } }) },
              roles: { cache: new Map([[ROLE_A, { id: ROLE_A, managed: false, position: 1 }]]) },
            },
          ],
        ]),
      },
    } as any;
    const routes = new Map<string, any>();
    registerApi(client, routes);

    const create = routes.get('POST /reaction-roles');
    const error = await create(guildId, {
      channelId: '200000000000000001',
      title: 'Colors',
      options: [
        { emoji: `<:blob:${EMOJI_ID}>`, roleId: ROLE_A },
        { emoji: `<a:blob:${EMOJI_ID}>`, roleId: ROLE_B },
      ],
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ statusCode: 400 });
    expect(String((error as Error).message)).toContain('options[1]: duplicate emoji');
    expect(send).not.toHaveBeenCalled();
  });
});
