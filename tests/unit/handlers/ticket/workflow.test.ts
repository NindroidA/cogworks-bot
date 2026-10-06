/**
 * /ticket manage status | assign | unassign tests (v3.16.12).
 *
 * - The three mutations now go through guardFeatureAccess('tickets', 'manage').
 *   A non-admin in a guild with no dashboard grants falls back to admin-only,
 *   so the guard must reply before any DB access.
 * - `status closed` used to flip only the DB status, stranding a live channel
 *   that every close path then refused. It now archives like the Close button.
 * - Panel tickets are stored as 'opened' and must read as the workflow's 'open'.
 *
 * ticketStatusHandler takes its repos and the archive workflow through `deps`.
 */

import { describe, expect, jest, test } from 'bun:test';
import { Not } from 'typeorm';
import {
  type TicketStatusDeps,
  ticketAssignHandler,
  ticketStatusHandler,
  ticketUnassignHandler,
} from '../../../../src/commands/handlers/ticket/workflow';
import ticketLang from '../../../../src/lang/en/ticket.json';

function makeInteraction(opts: { admin?: boolean; status?: string } = {}) {
  const interaction = {
    guildId: 'guild-wf-test',
    guild: {},
    channelId: 'chan1',
    channel: { id: 'chan1', send: jest.fn().mockResolvedValue(undefined) },
    client: { user: { id: 'bot' } },
    user: { id: 'staff1', username: 'staffer' },
    member: { permissions: { has: () => opts.admin ?? true }, roles: { cache: new Map() } },
    options: { getString: () => opts.status ?? 'closed', getUser: () => ({ id: 'u2' }) },
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: jest.fn(async () => {
      interaction.replied = true;
    }),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

function makeDeps(
  ticket: Record<string, unknown> = { id: 7, guildId: 'guild-wf-test', channelId: 'chan1', status: 'opened' },
) {
  const ticketRepo = {
    createQueryBuilder: () => {
      const qb = { where: () => qb, andWhere: () => qb, getOne: async () => ticket };
      return qb;
    },
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const deps = {
    ticketConfigRepo: { findOneBy: jest.fn().mockResolvedValue({ enableWorkflow: true, workflowStatuses: null }) },
    ticketRepo,
    archivedTicketConfigRepo: { findOneBy: jest.fn().mockResolvedValue({ channelId: 'forum-1' }) },
    archiveAndCloseTicket: jest.fn().mockResolvedValue({ success: true, archived: true, channelDeleted: true }),
  };
  return { deps: deps as unknown as TicketStatusDeps, ...deps };
}

describe('/ticket manage permission guard', () => {
  test('status: non-admin without a tickets grant is refused before any lookup', async () => {
    const interaction = makeInteraction({ admin: false });
    const { deps, ticketConfigRepo, archiveAndCloseTicket } = makeDeps();

    await ticketStatusHandler(interaction as never, deps);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0][0].content).toContain('Administrator');
    expect(ticketConfigRepo.findOneBy).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  // No deps seam on assign/unassign: without the guard they would reach the
  // real (uninitialized) repository and reject.
  test.each([
    ['assign', ticketAssignHandler],
    ['unassign', ticketUnassignHandler],
  ])('%s: non-admin without a tickets grant is refused', async (_name, handler) => {
    const interaction = makeInteraction({ admin: false });

    await handler(interaction as never);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0][0].content).toContain('Administrator');
  });
});

describe('/ticket manage status', () => {
  test('closed → acks, then claims and archives like the Close button (no status-only save)', async () => {
    const interaction = makeInteraction({ status: 'closed' });
    const { deps, ticketRepo, archiveAndCloseTicket } = makeDeps();

    await ticketStatusHandler(interaction as never, deps);

    expect(interaction.reply.mock.calls[0][0].content).toBe(ticketLang.close.closing);
    expect(ticketRepo.update).toHaveBeenCalledWith(
      { id: 7, guildId: 'guild-wf-test', status: Not('closed') },
      { status: 'closed' },
    );
    expect(archiveAndCloseTicket).toHaveBeenCalledTimes(1);
    expect(archiveAndCloseTicket.mock.calls[0][4]).toBe('forum-1');
    expect(archiveAndCloseTicket.mock.calls[0][6]).toEqual({ id: 'staff1', username: 'staffer' });
    expect(ticketRepo.save).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test('closed with the archive forum deleted → notConfigured, ticket untouched', async () => {
    const interaction = makeInteraction({ status: 'closed' });
    const { deps, archivedTicketConfigRepo, ticketRepo, archiveAndCloseTicket } = makeDeps();
    archivedTicketConfigRepo.findOneBy.mockResolvedValue({ channelId: '' });

    await ticketStatusHandler(interaction as never, deps);

    expect(interaction.reply.mock.calls[0][0].content).toContain(ticketLang.close.notConfigured);
    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('closed but the archive fails → status reverted and the user told', async () => {
    const interaction = makeInteraction({ status: 'closed' });
    const { deps, ticketRepo, archiveAndCloseTicket } = makeDeps();
    archiveAndCloseTicket.mockResolvedValue({ success: false, archived: false });

    await ticketStatusHandler(interaction as never, deps);

    expect(ticketRepo.update).toHaveBeenNthCalledWith(
      2,
      { id: 7, guildId: 'guild-wf-test', status: 'closed' },
      { status: 'opened' },
    );
    expect(interaction.followUp.mock.calls[0][0].content).toContain(ticketLang.close.transcriptCreate.error);
  });

  test("a panel ticket stored as 'opened' already counts as 'open'", async () => {
    const interaction = makeInteraction({ status: 'open' });
    const { deps, ticketRepo } = makeDeps();

    await ticketStatusHandler(interaction as never, deps);

    expect(interaction.reply.mock.calls[0][0].content).toContain('already in **Open** status');
    expect(ticketRepo.save).not.toHaveBeenCalled();
  });

  test('a regular status change still saves and announces', async () => {
    const interaction = makeInteraction({ status: 'in-progress' });
    const { deps, ticketRepo, archiveAndCloseTicket } = makeDeps();

    await ticketStatusHandler(interaction as never, deps);

    expect(ticketRepo.save).toHaveBeenCalledTimes(1);
    expect(ticketRepo.save.mock.calls[0][0].status).toBe('in-progress');
    expect(interaction.channel.send).toHaveBeenCalledTimes(1);
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });
});
