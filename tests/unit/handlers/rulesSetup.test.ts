/**
 * /rules setup reconfigure order (NindroidA/cogworks-bot#41, finding #98).
 *
 * Before: re-running setup deleted the old rules message first, so a failed
 * send (no Send Messages in the new channel) or a failed react (a custom emoji
 * from another server) left the server with no working rules message. Now the
 * new message is posted, reacted and saved first, and the old one is deleted
 * last; on failure the new message is removed and the old setup stays.
 *
 * Patches AppDataSource.getRepository for RulesConfig (restored in afterAll).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { lang } from '../../../src/lang';
import { AppDataSource } from '../../../src/typeorm';

type GetRepository = (entity: unknown) => unknown;

const OLD_CHANNEL = '400000000000000001';
const NEW_CHANNEL = '400000000000000002';
const OLD_MESSAGE = '500000000000000001';
const NEW_MESSAGE = '500000000000000002';
const ROLE = '600000000000000001';

let events: string[] = [];
let config: Record<string, any> | null = null;

const fakeRulesRepo = {
  async findOneBy() {
    return config;
  },
  create: (data: Record<string, unknown>) => ({ ...data }),
  async save(entity: Record<string, any>) {
    events.push(`save:${entity.messageId}`);
    config = { ...entity };
    return entity;
  },
};

let rulesSetupHandler: typeof import('../../../src/commands/handlers/rules/setup').rulesSetupHandler;
let original: GetRepository;

beforeAll(async () => {
  const ds = AppDataSource as unknown as { getRepository: GetRepository };
  original = ds.getRepository;
  ds.getRepository = (entity: any) => {
    if (entity?.name === 'RulesConfig') return fakeRulesRepo;
    throw new Error(`rules setup test: no fake repo for ${entity?.name}`);
  };
  ({ rulesSetupHandler } = await import('../../../src/commands/handlers/rules/setup'));
});
afterAll(() => {
  (AppDataSource as unknown as { getRepository: GetRepository }).getRepository = original;
});

let seq = 0;
beforeEach(() => {
  events = [];
  config = null;
});

function run(opts: { sendFails?: boolean; reactFails?: boolean } = {}) {
  // A fresh guild per run keeps the per-guild setup rate limit out of the way
  const guildId = `1000000000000${String(++seq).padStart(5, '0')}`;
  config = { guildId, channelId: OLD_CHANNEL, messageId: OLD_MESSAGE, roleId: ROLE, emoji: '✅', customMessage: null };

  const newMessage = {
    id: NEW_MESSAGE,
    async react() {
      events.push('react');
      if (opts.reactFails) throw Object.assign(new Error('Unknown Emoji'), { code: 10014 });
    },
    async delete() {
      events.push('delete:new');
    },
  };
  const newChannel = {
    id: NEW_CHANNEL,
    async send() {
      events.push('send');
      if (opts.sendFails) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      return newMessage;
    },
    toString: () => `<#${NEW_CHANNEL}>`,
  };
  const oldChannel = {
    isTextBased: () => true,
    messages: {
      fetch: async (id: string) => ({
        id,
        delete: async () => {
          events.push(`delete:${id === OLD_MESSAGE ? 'old' : id}`);
        },
      }),
    },
  };

  const edits: string[] = [];
  const interaction: any = {
    guildId,
    guild: {
      id: guildId,
      members: { fetchMe: async () => ({ roles: { highest: { position: 10 } } }) },
      channels: { fetch: async () => oldChannel },
    },
    member: { permissions: { has: () => true } },
    user: { id: '700000000000000001' },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    async deferReply() {
      interaction.deferred = true;
    },
    async editReply(o: { content: string }) {
      edits.push(o.content);
    },
    async reply(o: { content: string }) {
      edits.push(o.content);
    },
    options: {
      getSubcommand: () => 'setup',
      getChannel: () => newChannel,
      getRole: () => ({ id: ROLE, name: 'Member', position: 1, managed: false, toString: () => `<@&${ROLE}>` }),
      getString: () => null,
    },
  };
  return { interaction, edits, guildId };
}

describe('/rules setup when reconfiguring', () => {
  test('posts, reacts and saves the new message before deleting the old one', async () => {
    const { interaction, edits } = run();
    await rulesSetupHandler({} as any, interaction);

    expect(events).toEqual(['send', 'react', `save:${NEW_MESSAGE}`, 'delete:old']);
    expect(config?.messageId).toBe(NEW_MESSAGE);
    expect(edits[0]).toContain(lang.rules.setup.updated);
  });

  test('a failed send keeps the old message and config', async () => {
    const { interaction, edits } = run({ sendFails: true });
    await rulesSetupHandler({} as any, interaction);

    expect(events).toEqual(['send']);
    expect(config?.messageId).toBe(OLD_MESSAGE);
    expect(edits[0]).toContain(lang.rules.setup.error);
  });

  test('a failed react removes the new message and keeps the old one', async () => {
    const { interaction, edits } = run({ reactFails: true });
    await rulesSetupHandler({} as any, interaction);

    expect(events).toEqual(['send', 'react', 'delete:new']);
    expect(config?.messageId).toBe(OLD_MESSAGE);
    expect(edits[0]).toContain(lang.rules.setup.error);
  });
});
