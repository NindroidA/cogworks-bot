/**
 * Ticket auto-close tests (v3.16.13).
 *
 * Before this release the hourly job flipped status to 'closed' without
 * archiving, which stranded the channel (every close path refuses a 'closed'
 * ticket). It also never cleared its warning marker, never matched panel
 * tickets ('opened') when auto-close targeted 'open', and acted on rows loaded
 * at the start of the run. All dependencies are injected through the `deps`
 * argument, so there's no mock.module().
 */

import { describe, expect, jest, test } from 'bun:test';
import { Not } from 'typeorm';
import {
  type AutoCloseDeps,
  autoCloseWindow,
  checkAndAutoCloseTickets,
  decideAutoCloseAction,
  toWorkflowStatusId,
} from '../../../../src/utils/ticket/autoClose';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const config = { guildId: 'g1', autoCloseDays: 7, autoCloseWarningHours: 24, autoCloseStatus: 'resolved' };
const warning = (at: number) => ({
  status: 'resolved',
  changedBy: 'system',
  changedAt: new Date(at).toISOString(),
  note: 'autoclose-warning',
});

function ticketIdleFor(ms: number, warnedAgo?: number) {
  const now = Date.now();
  return {
    id: 7,
    guildId: 'g1',
    channelId: 'chan1',
    status: 'resolved',
    lastActivityAt: new Date(now - ms),
    statusHistory: warnedAgo === undefined ? null : [warning(now - warnedAgo)],
  };
}

function setup(
  tickets: Array<{ id: number }>,
  opts: { forumId?: string; fetch?: () => Promise<unknown>; reread?: (loaded: { id: number }) => unknown } = {},
) {
  const channel = { id: 'chan1', isTextBased: () => true, send: jest.fn().mockResolvedValue(undefined) };
  const queryCalls: unknown[][] = [];
  const qb = {
    where: (...a: unknown[]) => {
      queryCalls.push(a);
      return qb;
    },
    andWhere: (...a: unknown[]) => {
      queryCalls.push(a);
      return qb;
    },
    getMany: async () => tickets,
  };
  // The per-ticket re-read returns the loaded row unless a test changes it.
  const ticketRepo = {
    createQueryBuilder: () => qb,
    findOneBy: jest.fn(async ({ id }: { id: number }) => {
      const loaded = tickets.find(t => t.id === id);
      return loaded && opts.reread ? opts.reread(loaded) : (loaded ?? null);
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn(),
  };
  const archiveAndCloseTicket = jest.fn().mockResolvedValue({ success: true, archived: true, channelDeleted: true });
  const deps = {
    ticketConfigRepo: { find: jest.fn().mockResolvedValue([config]) },
    ticketRepo,
    archivedTicketConfigRepo: { findOneBy: jest.fn().mockResolvedValue({ channelId: opts.forumId ?? 'forum-1' }) },
    archiveAndCloseTicket,
  } as unknown as AutoCloseDeps;
  const client = {
    user: { id: 'bot', username: 'Cogworks' },
    channels: { fetch: jest.fn(opts.fetch ?? (async () => channel)) },
  } as never;
  return { deps, client, channel, ticketRepo, archiveAndCloseTicket, queryCalls };
}

describe('toWorkflowStatusId', () => {
  test("maps every stored 'open' alias to the workflow's 'open'", () => {
    expect(toWorkflowStatusId('opened')).toBe('open');
    expect(toWorkflowStatusId('created')).toBe('open');
    expect(toWorkflowStatusId('open')).toBe('open');
    expect(toWorkflowStatusId('resolved')).toBe('resolved');
  });
});

describe('decideAutoCloseAction', () => {
  const now = Date.now();
  const window = autoCloseWindow(config, now);
  const at = (idleMs: number, warnedAgo?: number) => ({
    lastActivityAt: new Date(now - idleMs),
    statusHistory: warnedAgo === undefined ? null : [warning(now - warnedAgo)],
  });

  test('not idle long enough → wait', () => {
    expect(decideAutoCloseAction(at(2 * DAY), window)).toBe('wait');
  });

  test('inside the warning window with no warning → warn', () => {
    expect(decideAutoCloseAction(at(6.5 * DAY), window)).toBe('warn');
  });

  test('a warning older than the last activity no longer counts → warn again', () => {
    // Warned 9 days ago, then someone replied 6.5 days ago; idle again since.
    const ticket = { lastActivityAt: new Date(now - 6.5 * DAY), statusHistory: [warning(now - 9 * DAY)] };
    expect(decideAutoCloseAction(ticket, window)).toBe('warn');
  });

  test('past the deadline with the warning up for its full window → close', () => {
    expect(decideAutoCloseAction(at(8 * DAY, 25 * HOUR), window)).toBe('close');
  });

  test('warning sent on schedule an hourly run ago → close on time, not a run late', () => {
    // The marker is stamped a few seconds into the run that sent it.
    expect(decideAutoCloseAction(at(7 * DAY + 60_000, 24 * HOUR - 30_000), window)).toBe('close');
  });

  test('past the deadline but the warning went out late → wait for its window', () => {
    expect(decideAutoCloseAction(at(10 * DAY, 2 * HOUR), window)).toBe('wait');
  });

  test('past the deadline with no warning ever sent → warn first, never a silent close', () => {
    expect(decideAutoCloseAction(at(10 * DAY), window)).toBe('warn');
  });
});

describe('checkAndAutoCloseTickets', () => {
  test('close runs the real archive path (claim → archiveAndCloseTicket) with the bot as closer', async () => {
    const { deps, client, channel, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(8 * DAY, 25 * HOUR)]);

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.update).toHaveBeenCalledTimes(1);
    expect(ticketRepo.update).toHaveBeenCalledWith(
      { id: 7, guildId: 'g1', status: Not('closed') },
      { status: 'closed' },
    );
    expect(archiveAndCloseTicket).toHaveBeenCalledTimes(1);
    const args = archiveAndCloseTicket.mock.calls[0];
    expect(args[3]).toBe(channel);
    expect(args[4]).toBe('forum-1');
    expect(args[6]).toEqual({ id: 'bot', username: 'Cogworks' });
    expect(ticketRepo.save).not.toHaveBeenCalled();
  });

  test('re-reads the ticket guild-scoped right before acting', async () => {
    const { deps, client, ticketRepo } = setup([ticketIdleFor(8 * DAY, 25 * HOUR)]);

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.findOneBy).toHaveBeenCalledWith({ id: 7, guildId: 'g1' });
  });

  test('stale snapshot: the user replied after the query loaded the ticket → not archived', async () => {
    // Loaded as due to close, but by its turn in the run someone has replied.
    const { deps, client, channel, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(8 * DAY, 25 * HOUR)], {
      reread: loaded => ({ ...loaded, lastActivityAt: new Date(Date.now() - 60_000) }),
    });

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  test.each([
    ['staff moved it out of the auto-close status', 'in-progress'],
    ['someone closed it by hand', 'closed'],
  ])('stale snapshot: %s after the query → not archived', async (_name, status) => {
    const { deps, client, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(8 * DAY, 25 * HOUR)], {
      reread: loaded => ({ ...loaded, status }),
    });

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('stale snapshot: the row was deleted meanwhile → nothing happens', async () => {
    const { deps, client, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(8 * DAY, 25 * HOUR)], {
      reread: () => null,
    });

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('stale snapshot: a reply after the query also cancels a pending warning', async () => {
    const { deps, client, channel, ticketRepo } = setup([ticketIdleFor(6.5 * DAY)], {
      reread: loaded => ({ ...loaded, lastActivityAt: new Date(Date.now() - 60_000) }),
    });

    await checkAndAutoCloseTickets(client, deps);

    expect(channel.send).not.toHaveBeenCalled();
    expect(ticketRepo.update).not.toHaveBeenCalled();
  });

  test('archive fails → status reverted so the next run retries', async () => {
    const { deps, client, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(8 * DAY, 25 * HOUR)]);
    archiveAndCloseTicket.mockResolvedValue({ success: false, archived: false });

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.update).toHaveBeenNthCalledWith(
      2,
      { id: 7, guildId: 'g1', status: 'closed' },
      { status: 'resolved' },
    );
  });

  test('archive forum deleted (channelId blanked) → guild skipped, nothing warned or closed', async () => {
    const { deps, client, channel, ticketRepo, archiveAndCloseTicket, queryCalls } = setup(
      [ticketIdleFor(8 * DAY, 25 * HOUR)],
      { forumId: '' },
    );

    await checkAndAutoCloseTickets(client, deps);

    expect(queryCalls).toHaveLength(0);
    expect(channel.send).not.toHaveBeenCalled();
    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test("auto-close on 'open' also matches panel tickets stored as 'opened'", async () => {
    const { deps, client, queryCalls } = setup([]);
    (deps.ticketConfigRepo.find as ReturnType<typeof jest.fn>).mockResolvedValue([
      { ...config, autoCloseStatus: 'open' },
    ]);

    await checkAndAutoCloseTickets(client, deps);

    expect(queryCalls).toContainEqual(['ticket.status IN (:...statuses)', { statuses: ['open', 'opened', 'created'] }]);
  });

  test('warning posts the embed and records the marker with a guild-scoped targeted update', async () => {
    const { deps, client, channel, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(6.5 * DAY)]);

    await checkAndAutoCloseTickets(client, deps);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(ticketRepo.update).toHaveBeenCalledTimes(1);
    const [criteria, partial] = ticketRepo.update.mock.calls[0];
    expect(criteria).toEqual({ id: 7, guildId: 'g1' });
    expect(partial.statusHistory.at(-1).note).toBe('autoclose-warning');
    expect(ticketRepo.save).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('channel fetch fails for a reason other than Unknown Channel → ticket left untouched', async () => {
    const { deps, client, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(8 * DAY, 25 * HOUR)], {
      fetch: () => Promise.reject(Object.assign(new Error('Missing Access'), { code: 50001 })),
    });

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('channel really gone (10003) past the deadline → row marked closed, no archive', async () => {
    const { deps, client, ticketRepo, archiveAndCloseTicket } = setup([ticketIdleFor(8 * DAY)], {
      fetch: () => Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003 })),
    });

    await checkAndAutoCloseTickets(client, deps);

    expect(ticketRepo.update).toHaveBeenCalledWith(
      { id: 7, guildId: 'g1', status: Not('closed') },
      { status: 'closed' },
    );
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });
});
