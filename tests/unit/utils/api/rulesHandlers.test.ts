/**
 * POST /rules/setup (dashboard "Post rules message").
 *
 * The dashboard saves the rules row itself (PUT /rules) and the BFF then sends
 * only { triggeredBy }. The handler used to require channelId/messageContent/
 * roleId in the body, so every dashboard post was a 400. It now falls back to
 * the stored row and runs the /rules setup checks before any Discord write.
 *
 * Same AppDataSource.getRepository runtime patch as memoryHandlers.test.ts.
 * The audit write isn't asserted: ticketHandlers.test.ts mock.module's
 * auditHelper process-wide, so it may be a fake here.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { Client } from 'discord.js';
import { lang } from '../../../../src/lang';

type Row = Record<string, any>;

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OLD_CHANNEL = '200000000000000002';
const ROLE = '300000000000000001';
const BFF_PAYLOAD = { triggeredBy: '400000000000000001' };

const state = {
  stored: null as Row | null,
  saved: [] as Row[],
  saveError: null as Error | null,
};

const fakeRepos: Record<string, unknown> = {
  RulesConfig: {
    findOneBy: async ({ guildId }: Row) => (state.stored?.guildId === guildId ? state.stored : null),
    create: (row: Row) => ({ ...row }),
    save: async (row: Row) => {
      if (state.saveError) throw state.saveError;
      state.saved.push({ ...row });
      return row;
    },
  },
  // Best-effort audit write for the BFF's triggeredBy
  AuditLog: { create: (row: Row) => row, save: async (row: Row) => row },
};

let originalGetRepository: ((entity: unknown) => unknown) | undefined;
let routes: Map<string, (guildId: string, body: Row) => Promise<unknown>>;
let channel: { isTextBased: () => boolean; send: ReturnType<typeof jest.fn> };
let sentMessage: { id: string; react: ReturnType<typeof jest.fn>; delete: ReturnType<typeof jest.fn> };
let oldMessageDelete: ReturnType<typeof jest.fn>;
let role: Row | null;
let botHighest: number;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: (e: unknown) => unknown };
  originalGetRepository = ds.getRepository;
  ds.getRepository = (entity: unknown) => {
    const repo = fakeRepos[(entity as { name?: string })?.name ?? ''];
    if (!repo) throw new Error(`Unmocked entity: ${(entity as { name?: string })?.name}`);
    return repo;
  };
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(async () => {
  state.stored = null;
  state.saved = [];
  state.saveError = null;
  role = { id: ROLE, name: 'Member', managed: false, position: 1 };
  botHighest = 10;
  sentMessage = { id: '500000000000000009', react: jest.fn(async () => undefined), delete: jest.fn(async () => undefined) };
  channel = { isTextBased: () => true, send: jest.fn(async () => sentMessage) };
  oldMessageDelete = jest.fn(async () => undefined);
  const oldChannel = {
    isTextBased: () => true,
    messages: { fetch: async (id: string) => ({ id, delete: oldMessageDelete }) },
  };
  const guild = {
    id: GUILD,
    channels: { fetch: async (id: string) => (id === CHANNEL ? channel : id === OLD_CHANNEL ? oldChannel : null) },
    roles: { fetch: async (id: string) => (id === role?.id ? role : null) },
    members: { fetchMe: async () => ({ roles: { highest: { position: botHighest } } }) },
  };
  const client = { guilds: { cache: new Map([[GUILD, guild]]) } } as unknown as Client;
  const { registerRulesHandlers } = await import('../../../../src/utils/api/handlers/rulesHandlers');
  routes = new Map();
  registerRulesHandlers(client, routes as never);
});

const setup = (body: Row) => routes.get('POST /rules/setup')!(GUILD, body);

/** A row as the dashboard's PUT /rules leaves it: not posted yet. */
const dashboardRow = (overrides: Row = {}) => ({
  guildId: GUILD,
  channelId: CHANNEL,
  messageId: '',
  roleId: ROLE,
  emoji: '✅',
  customMessage: null,
  ...overrides,
});

describe('POST /rules/setup from the dashboard', () => {
  test('the exact BFF payload posts from the stored config with the default text', async () => {
    state.stored = dashboardRow();

    const result = await setup(BFF_PAYLOAD);

    expect(result).toEqual({ success: true, messageId: sentMessage.id });
    const content = (channel.send.mock.calls[0] as unknown as [{ content: string }])[0].content;
    expect(content).toBe(lang.rules.setup.defaultMessage.replace('{emoji}', '✅').replace('{roleName}', 'Member'));
    expect(sentMessage.react).toHaveBeenCalledWith('✅');
    // Default text is not stored as a custom message
    expect(state.saved[0]).toMatchObject({ channelId: CHANNEL, messageId: sentMessage.id, roleId: ROLE, customMessage: null });
  });

  test('a stored custom message is posted as-is', async () => {
    state.stored = dashboardRow({ customMessage: 'Be kind. React below.' });
    await setup(BFF_PAYLOAD);
    expect((channel.send.mock.calls[0] as unknown as [{ content: string }])[0].content).toBe('Be kind. React below.');
    expect(state.saved[0].customMessage).toBe('Be kind. React below.');
  });

  test('no stored row and no body fields is still a 400, with nothing sent', async () => {
    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({ statusCode: 400 });
    expect(channel.send).not.toHaveBeenCalled();
  });

  test('re-post removes the previous rules message after the new one is saved', async () => {
    state.stored = dashboardRow({ channelId: CHANNEL, messageId: '500000000000000001' });
    // The previous message lived in another channel; the body moves it
    state.stored.channelId = OLD_CHANNEL;

    await setup({ ...BFF_PAYLOAD, channelId: CHANNEL });

    expect(state.saved[0]).toMatchObject({ channelId: CHANNEL, messageId: sentMessage.id });
    expect(oldMessageDelete).toHaveBeenCalledTimes(1);
  });
});

describe('POST /rules/setup validation (same checks as /rules setup)', () => {
  test('an invalid stored emoji is a 400 before anything is posted', async () => {
    state.stored = dashboardRow({ emoji: 'not-an-emoji' });
    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({ statusCode: 400, message: lang.rules.setup.invalidEmoji });
    expect(channel.send).not.toHaveBeenCalled();
  });

  test.each([
    ['@everyone', () => ({ id: GUILD, name: 'everyone', managed: false, position: 0 }), 'cannotUseEveryone'],
    ['a managed role', () => ({ id: ROLE, name: 'Bot', managed: true, position: 1 }), 'cannotUseManagedRole'],
    ['a role at or above the bot', () => ({ id: ROLE, name: 'Admin', managed: false, position: 10 }), 'roleTooHigh'],
  ] as const)('rejects %s', async (_label, makeRole, key) => {
    role = makeRole();
    state.stored = dashboardRow({ roleId: role.id });
    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({ statusCode: 400, message: lang.rules.setup[key] });
    expect(channel.send).not.toHaveBeenCalled();
    expect(state.saved).toHaveLength(0);
  });

  test('a deleted role is a 404', async () => {
    state.stored = dashboardRow();
    role = null;
    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({ statusCode: 404 });
    expect(channel.send).not.toHaveBeenCalled();
  });

  test('a custom message over 2000 characters is a 400', async () => {
    state.stored = dashboardRow({ customMessage: 'x'.repeat(2001) });
    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({ statusCode: 400 });
    expect(channel.send).not.toHaveBeenCalled();
  });

  test('a failed react deletes the posted message and saves nothing', async () => {
    state.stored = dashboardRow();
    sentMessage.react.mockImplementation(async () => {
      throw new Error('Unknown Emoji');
    });

    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({ statusCode: 400 });
    expect(sentMessage.delete).toHaveBeenCalledTimes(1);
    expect(state.saved).toHaveLength(0);
  });
});

describe('POST /rules/setup Discord and save failures', () => {
  const missingPermissions = () => Object.assign(new Error('Missing Permissions'), { code: 50013 });

  test('Missing Permissions on send is a 403 with a clear message, nothing saved', async () => {
    state.stored = dashboardRow();
    channel.send.mockImplementation(async () => {
      throw missingPermissions();
    });

    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('missing permission to send messages'),
    });
    expect(state.saved).toHaveLength(0);
  });

  test('Missing Permissions on react is a 403 naming Add Reactions, and the post is deleted', async () => {
    state.stored = dashboardRow();
    sentMessage.react.mockImplementation(async () => {
      throw missingPermissions();
    });

    await expect(setup(BFF_PAYLOAD)).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('Add Reactions'),
    });
    expect(sentMessage.delete).toHaveBeenCalledTimes(1);
  });

  test('a failed save after posting deletes the posted message and keeps the error', async () => {
    state.stored = dashboardRow();
    state.saveError = new Error('ER_LOCK_WAIT_TIMEOUT');

    await expect(setup(BFF_PAYLOAD)).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(sentMessage.delete).toHaveBeenCalledTimes(1);
  });
});
