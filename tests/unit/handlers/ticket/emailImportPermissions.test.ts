/**
 * Email-import channel overwrites (v3.16.11 regression).
 *
 * The channel used to grant only the bot and the global staff role, and the
 * global staff role was parsed with a mention-only regex — v3 setup stores it
 * raw, so it was silently dropped. The importer and every saved staff role
 * were left out, so a non-admin importer couldn't open the ticket they made.
 *
 * The last test drives emailImportModalHandler end to end (AppDataSource
 * patched with fake repos, same seam as role.test.ts) to pin the wiring: the
 * guild's StaffRole rows and roles cache must actually reach the builder.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ChannelType, PermissionsBitField } from 'discord.js';
import {
  buildEmailTicketPermissions,
  emailImportModalHandlerImpl as emailImportModalHandler,
} from '../../../../src/commands/handlers/ticket/emailImport';
import { AppDataSource } from '../../../../src/typeorm';
import type { BotConfig } from '../../../../src/typeorm/entities/BotConfig';
import { PermissionSets } from '../../../../src/utils/validation/permissionValidator';

const GUILD = '999999999999999999';
const IMPORTER = '423456789012345678';
const BOT = '523456789012345678';
const STAFF = '123456789012345678';
const ADMIN = '223456789012345678';
const GLOBAL = '623456789012345678';
const DELETED = '323456789012345678';

const existingRoles = new Set([GUILD, STAFF, ADMIN, GLOBAL]);

function build(botConfig: Partial<BotConfig>, staffRoleRefs: string[]) {
  return buildEmailTicketPermissions({
    guildId: GUILD,
    importerId: IMPORTER,
    botUserId: BOT,
    botConfig: botConfig as BotConfig,
    staffRoleRefs,
    existingRoles,
  });
}

describe('buildEmailTicketPermissions', () => {
  test('grants the importer, saved staff roles (raw + legacy), the raw global staff role and the bot', () => {
    const overwrites = build({ enableGlobalStaffRole: true, globalStaffRole: GLOBAL }, [STAFF, `<@&${ADMIN}>`]);

    expect(overwrites.map(o => o.id)).toEqual([GUILD, IMPORTER, STAFF, ADMIN, GLOBAL, BOT]);
    expect(overwrites[0].deny).toEqual(PermissionSets.DENY_ALL);
    expect(overwrites.find(o => o.id === IMPORTER)?.allow).toBe(PermissionSets.STAFF_MEMBER);
    expect(overwrites.find(o => o.id === BOT)?.allow).toContain(PermissionsBitField.Flags.ManageChannels);
  });

  test('skips a disabled global staff role, duplicates and deleted roles', () => {
    const disabled = build({ enableGlobalStaffRole: false, globalStaffRole: GLOBAL }, [STAFF]);
    expect(disabled.map(o => o.id)).toEqual([GUILD, IMPORTER, STAFF, BOT]);

    const messy = build({ enableGlobalStaffRole: true, globalStaffRole: `<@&${STAFF}>` }, [
      STAFF,
      DELETED,
      '@everyone',
    ]);
    expect(messy.map(o => o.id)).toEqual([GUILD, IMPORTER, STAFF, BOT]);
  });
});

describe('emailImportModalHandler', () => {
  const OTHER_GUILD_ROLE = '723456789012345678';
  const staffRows = [
    { guildId: GUILD, type: 'staff', role: STAFF },
    { guildId: GUILD, type: 'admin', role: `<@&${ADMIN}>` },
    { guildId: GUILD, type: 'staff', role: DELETED },
    { guildId: 'other-guild', type: 'staff', role: OTHER_GUILD_ROLE },
  ];

  const fakeRepos: Record<string, unknown> = {
    BotConfig: { findOneBy: async () => ({ guildId: GUILD, enableGlobalStaffRole: true, globalStaffRole: GLOBAL }) },
    TicketConfig: { findOneBy: async () => ({ guildId: GUILD, categoryId: 'category-1' }) },
    CustomTicketType: { findOne: async () => ({ typeId: 'email_import', embedColor: '#7289da' }) },
    StaffRole: {
      find: async (opts: { where: { guildId: string } }) => staffRows.filter(r => r.guildId === opts.where.guildId),
    },
    Ticket: { create: (row: object) => ({ id: 1, ...row }), save: async (row: object) => row },
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

  test('builds the channel from the guild StaffRole rows and skips roles missing from the roles cache', async () => {
    const createCalls: { permissionOverwrites: { id: string }[] }[] = [];
    const replies: unknown[] = [];
    const fields: Record<string, string> = {
      senderEmail: 'jane@example.com',
      senderName: 'Jane',
      subject: 'Help',
      body: 'Hello',
      attachments: '',
    };
    const interaction = {
      isRepliable: () => true,
      guildId: GUILD,
      user: { id: IMPORTER },
      client: { user: { id: BOT } },
      replied: false,
      deferred: false,
      fields: { getTextInputValue: (id: string) => fields[id] ?? '' },
      guild: {
        id: GUILD,
        roles: { cache: new Map([...existingRoles].map(id => [id, {}])) },
        channels: {
          fetch: async () => ({ id: 'category-1', type: ChannelType.GuildCategory }),
          create: async (args: { permissionOverwrites: { id: string }[] }) => {
            createCalls.push(args);
            return { id: 'channel-1', send: async () => ({ id: 'message-1' }), toString: () => '<#channel-1>' };
          },
        },
      },
      reply: async (args: unknown) => {
        replies.push(args);
      },
    };

    await emailImportModalHandler(interaction as never);

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].permissionOverwrites.map(o => o.id)).toEqual([GUILD, IMPORTER, STAFF, ADMIN, GLOBAL, BOT]);
    expect(replies).toHaveLength(1);
    expect((replies[0] as { content: string }).content).toContain('<#channel-1>');
  });
});
