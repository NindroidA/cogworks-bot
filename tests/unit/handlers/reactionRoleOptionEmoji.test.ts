/**
 * Reaction-role commands: option emoji identity in the command and dashboard
 * paths, plus the v3.16.33 fixes (deferred replies and targeted reaction
 * changes on add/remove/edit, Discord-first delete, validate's role check and
 * report size, the assignable-role check on add).
 *
 * Every reaction-role handler test lives in this file: each handler's lazyRepo
 * caches the first fake it resolves, so a second file's fakes would never reach
 * it.
 *
 * Option emoji identity:
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
import { PermissionFlagsBits, PermissionsBitField, Routes } from 'discord.js';
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
  /** What the reload after a change returns (null: the handler skips updateMenuMessage) */
  reloadMenu: null as Record<string, any> | null,
  menus: [] as Array<Record<string, any>>,
  saved: [] as Array<Record<string, any>>,
  removed: [] as Array<Record<string, any>>,
  menusRemoved: [] as Array<Record<string, any>>,
};

const fakeMenuRepo = {
  findOneCalls: 0,
  async findOne() {
    fakeMenuRepo.findOneCalls++;
    return fakeMenuRepo.findOneCalls === 1 ? state.menu : state.reloadMenu;
  },
  async find() {
    return state.menus;
  },
  async save(entity: Record<string, any>) {
    return entity;
  },
  async remove(entity: Record<string, any>) {
    state.menusRemoved.push(entity);
    return entity;
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

function makeInteraction(strings: Record<string, string>, roleId = ROLE_B, guildExtra: Record<string, unknown> = {}) {
  const interaction: any = {
    guildId,
    guild: {
      id: guildId,
      // Past the duplicate check: fail here so the test needs no role hierarchy
      members: { fetchMe: jest.fn(async () => Promise.reject(new Error('stop after the duplicate check'))) },
      ...guildExtra,
    },
    user: { id: '500000000000000001' },
    member: { permissions: { has: () => true } },
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    deferred: false,
    replied: false,
    isRepliable: () => true,
    options: {
      getString: (name: string) => strings[name] ?? null,
      getRole: () => ({ id: roleId, managed: false, position: 1, permissions: '0' }),
    },
    reply: jest.fn(async () => undefined),
    editReply: jest.fn(async () => undefined),
  };
  interaction.deferReply = jest.fn(async () => {
    interaction.deferred = true;
  });
  return interaction;
}

/** The handler's one reply: editReply once deferred, else reply. */
function replyText(interaction: { reply: { mock: { calls: any[][] } }; editReply: { mock: { calls: any[][] } } }) {
  return (interaction.editReply.mock.calls[0]?.[0]?.content ?? interaction.reply.mock.calls[0]?.[0]?.content ?? '') as string;
}

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

let addHandler: typeof import('../../../src/commands/handlers/reactionRole/add').reactionRoleAddHandler;
let removeHandler: typeof import('../../../src/commands/handlers/reactionRole/remove').reactionRoleRemoveHandler;
let editHandler: typeof import('../../../src/commands/handlers/reactionRole/edit').reactionRoleEditHandler;
let deleteHandler: typeof import('../../../src/commands/handlers/reactionRole/delete').reactionRoleDeleteHandler;
let validateHandler: typeof import('../../../src/commands/handlers/reactionRole/validate').reactionRoleValidateHandler;
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
  ({ reactionRoleEditHandler: editHandler } = await import('../../../src/commands/handlers/reactionRole/edit'));
  ({ reactionRoleDeleteHandler: deleteHandler } = await import('../../../src/commands/handlers/reactionRole/delete'));
  ({ reactionRoleValidateHandler: validateHandler } = await import(
    '../../../src/commands/handlers/reactionRole/validate'
  ));
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
  state.reloadMenu = null;
  state.menus = [];
  state.saved = [];
  state.removed = [];
  state.menusRemoved = [];
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

function dashboardCreate(
  roles: Array<{ id: string; managed: boolean; position: number; permissions?: string }> = [],
  members: Record<string, { highest: number; admin?: boolean }> = {},
) {
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
            members: {
              fetchMe: async () => ({ roles: { highest: { position: 10 } } }),
              fetch: async (id: string) => {
                const m = members[id];
                if (!m) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                const bits = m.admin ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageGuild;
                return { id, permissions: new PermissionsBitField(bits), roles: { highest: { position: m.highest } } };
              },
            },
            roles: { cache: roleCache },
          },
        ],
      ]),
    },
  } as any;
  const routes = new Map<string, any>();
  registerApi(client, routes);
  const create = (options: Array<{ emoji: string; roleId: string }>, triggeredBy?: string) =>
    routes.get('POST /reaction-roles')(guildId, { channelId: '200000000000000001', title: 'Colors', options, triggeredBy });
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

// ---------------------------------------------------------------------------
// add / remove / edit: deferred reply, only the changed reactions
// ---------------------------------------------------------------------------

const CHANNEL_ID = '200000000000000001';
const MESSAGE_ID = '300000000000000001';

/** A guild whose menu message records edits, reactions and own-reaction deletes. */
function menuGuild() {
  const message = { edit: jest.fn(async () => undefined), react: jest.fn(async () => undefined) };
  const channel = { isTextBased: () => true, messages: { fetch: jest.fn(async () => message) } };
  const restDelete = jest.fn(async () => undefined);
  const guild = {
    channels: { fetch: jest.fn(async () => channel) },
    members: {
      fetchMe: jest.fn(async () => ({ roles: { highest: { position: 20 } } })),
      fetch: jest.fn(async () => ({ roles: { highest: { position: 10 } } })),
    },
    ownerId: '500000000000000099',
    client: { rest: { delete: restDelete } },
  };
  return { guild, message, restDelete };
}

function menuWith(options: Array<{ id: number; emoji: string; roleId: string; sortOrder?: number }>) {
  return {
    id: 1,
    guildId,
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    name: 'Colors',
    mode: 'normal',
    options: options.map((o, i) => ({ sortOrder: i, ...o })),
  };
}

describe('/reactionrole add, remove and edit change only what changed', () => {
  test('add defers, reacts with the new emoji only, and answers with editReply', async () => {
    setMenu([{ id: 1, emoji: '🔴', roleId: ROLE_A }]);
    state.reloadMenu = menuWith([
      { id: 1, emoji: '🔴', roleId: ROLE_A },
      { id: 2, emoji: '1️⃣', roleId: ROLE_B },
    ]);
    const { guild, message } = menuGuild();
    const interaction = makeInteraction({ menu: '1', emoji: '1️⃣' }, ROLE_B, guild);

    await addHandler(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(message.react.mock.calls).toEqual([['1️⃣']]);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(replyText(interaction)).toContain('1️⃣');
    expect(state.saved).toHaveLength(1);
  });

  test('add refuses a role above the invoker before saving anything', async () => {
    setMenu([{ id: 1, emoji: '🔴', roleId: ROLE_A }]);
    const { guild } = menuGuild();
    const interaction = makeInteraction({ menu: '1', emoji: '🟢' }, ROLE_B, guild);
    interaction.options.getRole = () => ({ id: ROLE_B, managed: false, position: 15, permissions: '0' });

    await addHandler(interaction);

    expect(replyText(interaction)).toContain(lang.errors.assignableRole.aboveInvoker);
    expect(state.saved).toHaveLength(0);
  });

  test("remove takes the bot's own reaction off for the removed option", async () => {
    setMenu([
      { id: 1, emoji: '🔴', roleId: ROLE_A },
      { id: 2, emoji: `<:blob:${EMOJI_ID}>`, roleId: ROLE_B },
    ]);
    state.reloadMenu = menuWith([{ id: 1, emoji: '🔴', roleId: ROLE_A }]);
    const { guild, message, restDelete } = menuGuild();
    const interaction = makeInteraction({ menu: '1', emoji: `<:blob:${EMOJI_ID}>` }, ROLE_B, guild);

    await removeHandler(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(message.react).not.toHaveBeenCalled();
    expect(restDelete.mock.calls).toEqual([[Routes.channelMessageOwnReaction(CHANNEL_ID, MESSAGE_ID, `blob:${EMOJI_ID}`)]]);
    expect(replyText(interaction)).not.toContain(tl.remove.notFound);
  });

  test('edit updates the embed without touching reactions', async () => {
    state.menu = menuWith([
      { id: 1, emoji: '🔴', roleId: ROLE_A },
      { id: 2, emoji: '🟢', roleId: ROLE_B },
    ]);
    const { guild, message, restDelete } = menuGuild();
    const interaction = makeInteraction({ menu: '1', name: 'Colours' }, ROLE_B, guild);

    await editHandler(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(message.react).not.toHaveBeenCalled();
    expect(restDelete).not.toHaveBeenCalled();
    expect(replyText(interaction)).toContain('Colours');
  });
});

// ---------------------------------------------------------------------------
// delete: Discord first
// ---------------------------------------------------------------------------

function deleteInteraction(channelFetch: () => Promise<unknown>) {
  const button = { customId: 'rr-delete_yes', update: jest.fn(async () => undefined), editReply: jest.fn(async () => undefined) };
  const interaction = makeInteraction({ menu: '1' }, ROLE_B, { channels: { fetch: jest.fn(channelFetch) } });
  interaction.reply = jest.fn(async () => ({ awaitMessageComponent: async () => button }));
  return { interaction, button };
}

function channelWithMessage(deleteResult: () => Promise<unknown>) {
  const msg = { id: MESSAGE_ID, delete: jest.fn(deleteResult) };
  return { isTextBased: () => true, messages: { fetch: async () => msg } };
}

describe('/reactionrole delete', () => {
  test('keeps the menu when the message could not be deleted', async () => {
    state.menu = menuWith([]);
    const channel = channelWithMessage(() => Promise.reject(Object.assign(new Error('Missing Permissions'), { code: 50013 })));
    const { interaction, button } = deleteInteraction(async () => channel);

    await deleteHandler(interaction);

    expect(state.menusRemoved).toHaveLength(0);
    expect(button.editReply.mock.calls[0][0].content).toContain(tl.delete.messageNotDeleted.replace('{name}', 'Colors'));
  });

  test('keeps the menu when the channel cannot be read', async () => {
    state.menu = menuWith([]);
    const { interaction } = deleteInteraction(() =>
      Promise.reject(Object.assign(new Error('Missing Access'), { code: 50001 })),
    );

    await deleteHandler(interaction);

    expect(state.menusRemoved).toHaveLength(0);
  });

  test.each([
    ['the message was deleted', () => async () => channelWithMessage(async () => undefined)],
    [
      'the message was already gone',
      () => async () => channelWithMessage(() => Promise.reject(Object.assign(new Error('Unknown Message'), { code: 10008 }))),
    ],
    ['the channel was already gone', () => () => Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003 }))],
  ])('removes the menu when %s', async (_label, makeFetch) => {
    state.menu = menuWith([]);
    const { interaction, button } = deleteInteraction(makeFetch() as () => Promise<unknown>);

    await deleteHandler(interaction);

    expect(state.menusRemoved).toHaveLength(1);
    expect(button.editReply.mock.calls[0][0].content).toBe(tl.delete.success.replace('{name}', 'Colors'));
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

const DELETED_ROLE = '600000000000000009';
const FLAKY_ROLE = '600000000000000008';

function validateInteraction(channelFetch: () => Promise<unknown>) {
  return makeInteraction({}, ROLE_B, {
    channels: { fetch: jest.fn(channelFetch) },
    roles: {
      fetch: jest.fn(async (id: string) => {
        if (id === DELETED_ROLE) return null; // discord.js returns null for Unknown Role
        if (id === FLAKY_ROLE) throw new Error('503 Service Unavailable');
        return { id };
      }),
    },
  });
}

describe('/reactionrole validate', () => {
  test('reports a deleted role, but not one it could not check', async () => {
    state.menus = [
      menuWith([
        { id: 1, emoji: '🔴', roleId: DELETED_ROLE },
        { id: 2, emoji: '🟢', roleId: FLAKY_ROLE },
        { id: 3, emoji: '🔵', roleId: ROLE_A },
      ]),
    ];
    const interaction = validateInteraction(async () => ({ messages: { fetch: async () => ({}) } }));

    await validateHandler(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data;
    expect(embed.description).toContain('1 issue(s)');
    expect(embed.description).toContain(tl.validate.roleMissing.replace('{name}', 'Colors').replace('{emoji}', '🔴'));
    expect(embed.description).not.toContain('🟢');
  });

  test('a report with many issues still fits the embed', async () => {
    state.menus = Array.from({ length: 80 }, (_, i) => ({ ...menuWith([]), name: `Menu number ${i}` }));
    const interaction = validateInteraction(() => Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003 })));

    await validateHandler(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds?.[0]?.data;
    expect(embed).toBeDefined();
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(embed.description.startsWith('80 issue(s)')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dashboard create: the dashboard user is the actor
// ---------------------------------------------------------------------------

describe('dashboard menu create judges roles by the dashboard user', () => {
  const ADMIN_ROLE = { id: ROLE_B, managed: false, position: 3, permissions: String(PermissionFlagsBits.Administrator) };
  const MANAGER = '500000000000000002';
  const ADMIN = '500000000000000003';

  test('a Manage Server user cannot create a menu that hands out Administrator', async () => {
    const { create, send } = dashboardCreate([ADMIN_ROLE], { [MANAGER]: { highest: 5 } });
    const error = await create([{ emoji: '✅', roleId: ROLE_B }], MANAGER).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 400 });
    expect(String((error as Error).message)).toContain(lang.errors.assignableRole.privileged);
    expect(send).not.toHaveBeenCalled();
  });

  test('a role above the dashboard user is refused', async () => {
    const { create, send } = dashboardCreate([{ id: ROLE_B, managed: false, position: 6 }], { [ADMIN]: { highest: 5, admin: true } });
    const error = await create([{ emoji: '✅', roleId: ROLE_B }], ADMIN).catch((e: unknown) => e);
    expect(String((error as Error).message)).toContain(lang.errors.assignableRole.aboveInvoker);
    expect(send).not.toHaveBeenCalled();
  });

  test('an admin dashboard user can hand out a privileged role below them', async () => {
    const { create, send } = dashboardCreate([ADMIN_ROLE], { [ADMIN]: { highest: 5, admin: true } });
    await create([{ emoji: '✅', roleId: ROLE_B }], ADMIN).catch(() => undefined);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['who left the server', '500000000000000004'],
    ['not given', undefined],
  ])('a privileged role is refused when the dashboard user is %s', async (_label, triggeredBy) => {
    const { create, send } = dashboardCreate([ADMIN_ROLE]);
    const error = await create([{ emoji: '✅', roleId: ROLE_B }], triggeredBy).catch((e: unknown) => e);
    expect(String((error as Error).message)).toContain(lang.errors.assignableRole.privileged);
    expect(send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// add / remove / edit when the menu message can't be updated
// ---------------------------------------------------------------------------

describe('/reactionrole when the menu message cannot be updated', () => {
  test('add takes the option out again when the reaction fails', async () => {
    state.menu = menuWith([{ id: 1, emoji: '🔴', roleId: ROLE_A }]);
    state.reloadMenu = menuWith([
      { id: 1, emoji: '🔴', roleId: ROLE_A },
      { id: 2, emoji: '<:gone:700000000000000003>', roleId: ROLE_B },
    ]);
    const { guild, message } = menuGuild();
    message.react.mockImplementation(async () => {
      throw Object.assign(new Error('Unknown Emoji'), { code: 10014 });
    });
    const interaction = makeInteraction({ menu: '1', emoji: '<:gone:700000000000000003>' }, ROLE_B, guild);

    await addHandler(interaction);

    expect(state.saved).toHaveLength(1);
    expect(state.removed).toEqual(state.saved);
    // The embed is put back to the menu without the option
    expect(message.edit).toHaveBeenCalledTimes(2);
    expect(replyText(interaction)).toContain(tl.add.menuUpdateFailed);
  });

  test('remove and edit save, then warn that the message is stale', async () => {
    const failingGuild = () => {
      const { guild } = menuGuild();
      guild.channels.fetch = jest.fn(async () => {
        throw Object.assign(new Error('Missing Access'), { code: 50001 });
      });
      return guild;
    };

    setMenu([{ id: 1, emoji: '🔴', roleId: ROLE_A }]);
    state.reloadMenu = menuWith([]);
    const removeInteraction = makeInteraction({ menu: '1', emoji: '🔴' }, ROLE_B, failingGuild());
    await removeHandler(removeInteraction);
    expect(state.removed).toHaveLength(1);
    expect(replyText(removeInteraction)).toContain(tl.menu.updateFailed);

    fakeMenuRepo.findOneCalls = 0;
    state.menu = menuWith([{ id: 1, emoji: '🔴', roleId: ROLE_A }]);
    const editInteraction = makeInteraction({ menu: '1', name: 'Colours' }, ROLE_B, failingGuild());
    await editHandler(editInteraction);
    expect(replyText(editInteraction)).toContain('Colours');
    expect(replyText(editInteraction)).toContain(tl.menu.updateFailed);
  });
});
