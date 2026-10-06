/**
 * routeTicket / pickTicketAssignee against a hand-rolled guild fake.
 *
 * Covers who counts as available (the bot runs without the privileged
 * GuildPresences intent, so presence data never arrives), the opener never
 * being picked, the full member fetch in small guilds (the member cache keeps
 * only 200), and the gating that keeps ticket creation safe.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { Collection, GatewayIntentBits, IntentsBitField } from 'discord.js';
import { Repository } from 'typeorm';
import {
  pickTicketAssignee,
  revokeAssigneeAccess,
  routeTicket,
  type TicketRoutingConfig,
} from '../../../../src/utils/ticket/smartRouter';

const ROLE = '555555555555555555';
const RULES = [{ ticketTypeId: 'bug_report', staffRoleId: ROLE }];

interface FakeMemberInit {
  id: string;
  bot?: boolean;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  hasRole?: boolean;
}

function fakeMember({ id, bot = false, status, hasRole = true }: FakeMemberInit) {
  return {
    id,
    user: { bot },
    presence: status ? { status } : null,
    roles: { cache: new Map(hasRole ? [[ROLE, {}]] : []) },
  };
}

function fakeGuild(opts: {
  cached?: FakeMemberInit[];
  fetched?: FakeMemberInit[] | Error;
  presences?: boolean;
  memberCount?: number;
}) {
  const intents = [GatewayIntentBits.Guilds, ...(opts.presences ? [GatewayIntentBits.GuildPresences] : [])];
  const cached = new Collection((opts.cached ?? []).map(m => [m.id, fakeMember(m)] as const));
  const fetch = jest.fn(async () => {
    if (opts.fetched instanceof Error) throw opts.fetched;
    return new Collection((opts.fetched ?? []).map(m => [m.id, fakeMember(m)] as const));
  });
  const guild = {
    id: 'guild1',
    memberCount: opts.memberCount ?? 50,
    client: { options: { intents: new IntentsBitField(intents) } },
    roles: { cache: new Map([[ROLE, { id: ROLE, members: cached }]]) },
    members: { fetch },
  };
  return { guild: guild as never, fetch };
}

const ROUTING_ON: TicketRoutingConfig = {
  smartRoutingEnabled: true,
  enableWorkflow: true,
  routingRules: RULES,
  routingStrategy: 'least-load',
};

let queryBuilderSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  // getStaffWorkload: nobody has open tickets.
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  queryBuilderSpy = jest.spyOn(Repository.prototype, 'createQueryBuilder').mockReturnValue(qb as never);
});

afterEach(() => {
  queryBuilderSpy.mockRestore();
});

describe('routeTicket availability', () => {
  test('without presence data every non-bot role member is available', async () => {
    const { guild } = fakeGuild({ fetched: [{ id: 'bot1', bot: true }, { id: 'staff1' }] });

    const result = await routeTicket(guild, 'bug_report', RULES, 'least-load');

    expect(result.member?.id).toBe('staff1');
  });

  test('never picks the excluded member (the opener)', async () => {
    const { guild } = fakeGuild({ fetched: [{ id: 'opener' }, { id: 'staff1' }] });

    const result = await routeTicket(guild, 'bug_report', RULES, 'least-load', 'opener');

    expect(result.member?.id).toBe('staff1');
  });

  test('with the presence intent only online or idle members count', async () => {
    const { guild } = fakeGuild({
      presences: true,
      fetched: [
        { id: 'dnd1', status: 'dnd' },
        { id: 'off1', status: 'offline' },
        { id: 'unknown1' },
        { id: 'idle1', status: 'idle' },
      ],
    });

    const result = await routeTicket(guild, 'bug_report', RULES, 'least-load');

    expect(result.member?.id).toBe('idle1');
  });

  test('a small guild fetches members, so staff outside the cache are found', async () => {
    const { guild, fetch } = fakeGuild({ cached: [], fetched: [{ id: 'staff1' }, { id: 'member1', hasRole: false }] });

    const result = await routeTicket(guild, 'bug_report', RULES, 'least-load');

    expect(fetch).toHaveBeenCalled();
    expect(result.member?.id).toBe('staff1');
  });

  test('a failed member fetch falls back to the cached role members', async () => {
    const { guild } = fakeGuild({ cached: [{ id: 'cached1' }], fetched: new Error('timeout') });

    const result = await routeTicket(guild, 'bug_report', RULES, 'least-load');

    expect(result.member?.id).toBe('cached1');
  });

  test('a large guild uses the cache without a full fetch', async () => {
    const { guild, fetch } = fakeGuild({ cached: [{ id: 'cached1' }], memberCount: 50_000 });

    const result = await routeTicket(guild, 'bug_report', RULES, 'least-load');

    expect(fetch).not.toHaveBeenCalled();
    expect(result.member?.id).toBe('cached1');
  });
});

describe('pickTicketAssignee', () => {
  test.each([
    ['routing off', { smartRoutingEnabled: false }],
    ['workflow off', { enableWorkflow: false }],
    ['no rules', { routingRules: [] }],
    ['null rules', { routingRules: null }],
  ])('returns null without touching the guild when %s', async (_label, overrides) => {
    const guild = new Proxy(
      {},
      {
        get() {
          throw new Error('guild must not be read');
        },
      },
    );

    const result = await pickTicketAssignee(guild as never, 'bug_report', { ...ROUTING_ON, ...overrides }, 'opener');

    expect(result).toBeNull();
  });

  test('returns null for a type without a rule', async () => {
    const { guild } = fakeGuild({ fetched: [{ id: 'staff1' }] });

    expect(await pickTicketAssignee(guild, 'other', ROUTING_ON, 'opener')).toBeNull();
  });

  test('picks a staff member other than the opener', async () => {
    const { guild } = fakeGuild({ fetched: [{ id: 'opener' }, { id: 'staff1' }] });

    const member = await pickTicketAssignee(guild, 'bug_report', ROUTING_ON, 'opener');

    expect(member?.id).toBe('staff1');
  });

  test('swallows a routing error and returns null', async () => {
    const guild = {
      id: 'guild1',
      get roles(): never {
        throw new Error('cache exploded');
      },
    };

    expect(await pickTicketAssignee(guild as never, 'bug_report', ROUTING_ON, 'opener')).toBeNull();
  });
});

describe('revokeAssigneeAccess', () => {
  const TICKET = { guildId: 'guild1', createdBy: 'opener' };

  function channelWith(ids: string[], fail = false) {
    return {
      permissionOverwrites: {
        cache: new Map(ids.map(id => [id, {}])),
        delete: jest.fn(async () => {
          if (fail) throw new Error('Missing Permissions');
        }),
      },
    };
  }

  test('deletes the former assignee member overwrite', async () => {
    const channel = channelWith(['opener', 'staff1']);
    await revokeAssigneeAccess(channel, TICKET, 'staff1');
    expect(channel.permissionOverwrites.delete).toHaveBeenCalledWith('staff1');
  });

  test.each([
    ['the opener', 'opener'],
    ['nobody', null],
    ['a member without an overwrite', 'manual1'],
  ])('leaves overwrites alone for %s', async (_label, former) => {
    const channel = channelWith(['opener', 'staff1']);
    await revokeAssigneeAccess(channel, TICKET, former);
    expect(channel.permissionOverwrites.delete).not.toHaveBeenCalled();
  });

  test('a failed delete is logged, not thrown', async () => {
    const channel = channelWith(['staff1'], true);
    await expect(revokeAssigneeAccess(channel, TICKET, 'staff1')).resolves.toBeUndefined();
  });
});
