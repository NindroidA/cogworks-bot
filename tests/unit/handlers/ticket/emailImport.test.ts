/**
 * /ticket manage import-email (v3.16.31).
 *
 * - Opening the modal used a per-user budget shared across every server; it is
 *   now per user per server.
 * - The first import created the internal 'email_import' type as ACTIVE, so it
 *   showed in every member's ticket menu. It is now created inactive.
 * - The embed was built after the channel existed: a long subject or long
 *   attachment URLs made a builder throw and left an empty channel with no
 *   ticket row. The embed is now built first, the title is clamped, long link
 *   lists go in follow-up messages, and any failure before the ticket row is
 *   saved deletes the channel.
 * - The subject input allowed 256 characters for a varchar(255) column.
 *
 * Uses the *Impl alias for the modal handler: ticketInteraction.test.ts
 * mock.module()s this module process-wide and replaces emailImportModalHandler.
 */

import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test';
import { ChannelType } from 'discord.js';
import {
  buildEmailTicketEmbed,
  emailImportHandler,
  emailImportModalHandlerImpl as emailImportModalHandler,
} from '../../../../src/commands/handlers/ticket/emailImport';
import { AppDataSource } from '../../../../src/typeorm';
import { createRateLimitKey, RateLimits, rateLimiter } from '../../../../src/utils/security/rateLimiter';

const GUILD_A = '100000000000000001';
const GUILD_B = '100000000000000002';

describe('emailImportHandler (opening the modal)', () => {
  function openInteraction(guildId: string, userId: string) {
    return {
      guildId,
      guild: { id: guildId },
      user: { id: userId },
      member: { permissions: { has: () => true } },
      deferred: false,
      replied: false,
      isRepliable: () => true,
      reply: jest.fn(async () => undefined),
      showModal: jest.fn(async () => undefined),
    };
  }

  test('the budget is per user per server', async () => {
    const userId = 'email-import-budget-user';
    for (let i = 0; i < RateLimits.TICKET_CREATE.maxAttempts; i++) {
      const interaction = openInteraction(GUILD_A, userId);
      await emailImportHandler(interaction as never);
      expect(interaction.showModal).toHaveBeenCalledTimes(1);
    }

    const spent = openInteraction(GUILD_A, userId);
    await emailImportHandler(spent as never);
    expect(spent.showModal).not.toHaveBeenCalled();
    expect(spent.reply).toHaveBeenCalledTimes(1);

    const otherServer = openInteraction(GUILD_B, userId);
    await emailImportHandler(otherServer as never);
    expect(otherServer.showModal).toHaveBeenCalledTimes(1);
    expect(
      rateLimiter.getRemaining(
        createRateLimitKey.userGuild(userId, GUILD_B, 'email-import'),
        RateLimits.TICKET_CREATE.maxAttempts,
      ),
    ).toBe(RateLimits.TICKET_CREATE.maxAttempts - 1);
  });

  test('the subject input fits tickets.emailSubject (varchar 255)', async () => {
    const interaction = openInteraction(GUILD_A, 'email-import-subject-user');
    await emailImportHandler(interaction as never);

    const modal = (interaction.showModal.mock.calls[0] as unknown as [{ toJSON: () => unknown }])[0].toJSON() as {
      components: { components: { custom_id: string; max_length?: number }[] }[];
    };
    const subject = modal.components.flatMap(row => row.components).find(c => c.custom_id === 'subject');
    expect(subject?.max_length).toBe(255);
  });
});

describe('buildEmailTicketEmbed', () => {
  const base = {
    body: 'Hello',
    senderName: 'Jane',
    senderEmail: 'jane@example.com',
    userId: '423456789012345678',
    embedColor: '#7289da',
  };

  test('a 255-character emoji subject still makes a valid title', () => {
    const { embed } = buildEmailTicketEmbed({ ...base, subject: '🙂'.repeat(127) + 'x', attachmentUrls: [] });
    const title = embed.toJSON().title ?? '';
    expect(title.length).toBeLessThanOrEqual(256);
    expect(title.endsWith('…')).toBe(true);
    expect(title.isWellFormed()).toBe(true);
  });

  test('short attachment links stay in the embed', () => {
    const urls = ['https://example.com/a.png', 'https://example.com/b.pdf'];
    const { embed, attachmentMessages } = buildEmailTicketEmbed({ ...base, subject: 'Hi', attachmentUrls: urls });
    expect(embed.toJSON().fields?.find(f => f.name === 'Attachments')?.value).toContain('[Attachment 2]');
    expect(attachmentMessages).toEqual([]);
  });

  test('ten 500-character links go to follow-up messages under 2,000 characters each', () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://bucket.example.com/${i}?sig=${'s'.repeat(470)}`);
    const { embed, attachmentMessages } = buildEmailTicketEmbed({ ...base, subject: 'Hi', attachmentUrls: urls });

    expect(embed.toJSON().fields?.some(f => f.name === 'Attachments')).toBe(false);
    expect(attachmentMessages.length).toBeGreaterThan(1);
    for (const message of attachmentMessages) expect(message.length).toBeLessThanOrEqual(2000);
    expect(attachmentMessages.join('\n').match(/\[Attachment \d+\]/g)).toHaveLength(10);
  });
});

describe('emailImportModalHandler', () => {
  let ticketTypeRow: Record<string, unknown> | null = null;
  let failSave = false;
  const typeRepo = {
    findOne: async () => ticketTypeRow,
    create: jest.fn((row: object) => ({ ...row })),
    save: jest.fn(async (row: object) => row),
  };
  const ticketRepo = {
    create: (row: object) => ({ id: 1, ...row }),
    save: jest.fn(async (row: object) => {
      if (failSave) throw new Error("Data too long for column 'emailSubject'");
      return row;
    }),
  };
  const fakeRepos: Record<string, unknown> = {
    BotConfig: { findOneBy: async () => ({ guildId: GUILD_A, enableGlobalStaffRole: false }) },
    TicketConfig: { findOneBy: async () => ({ guildId: GUILD_A, categoryId: 'category-1' }) },
    CustomTicketType: typeRepo,
    StaffRole: { find: async () => [] },
    Ticket: ticketRepo,
  };

  type RepoGetter = { getRepository: (entity: { name?: string }) => unknown };
  let originalGetRepository: RepoGetter['getRepository'];

  beforeAll(() => {
    originalGetRepository = (AppDataSource as unknown as RepoGetter).getRepository;
    (AppDataSource as unknown as RepoGetter).getRepository = entity => {
      const repo = entity?.name ? fakeRepos[entity.name] : undefined;
      if (!repo) throw new Error(`emailImport test: unexpected repo ${entity?.name}`);
      return repo;
    };
  });

  afterAll(() => {
    (AppDataSource as unknown as RepoGetter).getRepository = originalGetRepository;
  });

  /** Each call uses its own importer: the submit shares the 3-per-hour ticket budget. */
  function submitInteraction(userId: string, send: () => Promise<unknown>) {
    const channel = {
      id: 'channel-1',
      send: jest.fn(send),
      delete: jest.fn(async () => undefined),
      toString: () => '<#channel-1>',
    };
    const fields: Record<string, string> = {
      senderEmail: 'jane@example.com',
      senderName: 'Jane',
      subject: 'Help',
      body: 'Hello',
      attachments: '',
    };
    const interaction = {
      isRepliable: () => true,
      guildId: GUILD_A,
      user: { id: userId },
      client: { user: { id: 'bot-1' } },
      replied: false,
      deferred: false,
      fields: { getTextInputValue: (id: string) => fields[id] ?? '' },
      guild: {
        id: GUILD_A,
        roles: { cache: new Map() },
        channels: {
          fetch: async () => ({ id: 'category-1', type: ChannelType.GuildCategory }),
          create: jest.fn(async () => channel),
        },
      },
      reply: jest.fn(async () => undefined),
      followUp: jest.fn(async () => undefined),
    };
    return { interaction, channel };
  }

  test('the first import creates the internal email_import type inactive', async () => {
    ticketTypeRow = null;
    failSave = false;
    const { interaction, channel } = submitInteraction('importer-type', async () => ({ id: 'message-1' }));

    await emailImportModalHandler(interaction as never);

    expect(typeRepo.create).toHaveBeenCalledTimes(1);
    expect((typeRepo.create.mock.calls[0] as unknown as [{ typeId: string; isActive: boolean }])[0]).toMatchObject({
      typeId: 'email_import',
      isActive: false,
    });
    expect(channel.delete).not.toHaveBeenCalled();
  });

  test('a failed welcome message deletes the new channel', async () => {
    ticketTypeRow = { typeId: 'email_import', embedColor: '#7289da' };
    failSave = false;
    const { interaction, channel } = submitInteraction('importer-send', async () => {
      throw new Error('Missing Access');
    });

    await emailImportModalHandler(interaction as never);

    expect(channel.delete).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  test('a failed ticket insert deletes the new channel', async () => {
    ticketTypeRow = { typeId: 'email_import', embedColor: '#7289da' };
    failSave = true;
    const { interaction, channel } = submitInteraction('importer-save', async () => ({ id: 'message-1' }));

    await emailImportModalHandler(interaction as never);

    expect(channel.delete).toHaveBeenCalledTimes(1);
  });
});
