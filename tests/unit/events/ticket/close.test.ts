/**
 * ticketCloseEvent regression tests — the "close button hangs / ticket never
 * closes" hotfix.
 *
 * confirmClose acknowledges the click with interaction.update({ content:
 * "Closing ticket..." }) BEFORE calling ticketCloseEvent. Historically every
 * early return in ticketCloseEvent (no archive config / no ticket / already
 * closed) was a bare `return`, leaving that ephemeral message frozen forever —
 * the reported permanent hang. These tests lock in that EVERY exit now either
 * deletes the channel (happy path) or surfaces user feedback, and that an
 * unexpected throw from the workflow reverts the status instead of stranding
 * the ticket 'closed' with a live channel.
 *
 * All dependencies are injected via the function's `deps` argument (the same
 * deterministic seam closeWorkflow.ts uses) — no mock.module(), which bun
 * applies inconsistently across a full-suite run.
 */

import { describe, expect, jest, test } from 'bun:test';
import { Not } from 'typeorm';
import { type TicketCloseDeps, ticketCloseEvent } from '../../../../src/events/ticket/close';
import ticketLang from '../../../../src/lang/en/ticket.json';

const tl = ticketLang.close;

function makeDeps(overrides: Partial<Record<keyof TicketCloseDeps, unknown>> = {}) {
  const archivedTicketConfigRepo = { findOneBy: jest.fn().mockResolvedValue({ channelId: 'forum-1' }) };
  const ticketRepo = {
    findOneBy: jest.fn().mockResolvedValue({ id: 7, guildId: 'guild1', channelId: 'chan1', status: 'opened' }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const archiveAndCloseTicket = jest.fn().mockResolvedValue({ success: true, archived: true });
  const replyEphemeralError = jest.fn().mockResolvedValue(undefined);
  return {
    deps: {
      archivedTicketConfigRepo,
      ticketRepo,
      archiveAndCloseTicket,
      replyEphemeralError,
      ...overrides,
    } as unknown as TicketCloseDeps,
    archivedTicketConfigRepo,
    ticketRepo,
    archiveAndCloseTicket,
    replyEphemeralError,
  };
}

function makeInteraction() {
  return {
    guildId: 'guild1',
    channelId: 'chan1',
    channel: { id: 'chan1' },
    user: { id: 'user1', username: 'closer-user' },
    replied: true,
    deferred: false,
  } as never;
}

const client = {} as never;

describe('ticketCloseEvent', () => {
  test('no ArchivedTicketConfig → surfaces feedback, never silently returns, never closes', async () => {
    const { deps, archivedTicketConfigRepo, ticketRepo, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    archivedTicketConfigRepo.findOneBy.mockResolvedValue(null);

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledTimes(1);
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.notConfigured);
    // Guard must short-circuit BEFORE marking closed or archiving.
    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('no Ticket row → surfaces feedback and does not proceed', async () => {
    const { deps, ticketRepo, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    ticketRepo.findOneBy.mockResolvedValue(null);

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledTimes(1);
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.notFound);
    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('ticket already closed → surfaces feedback, no duplicate archive', async () => {
    const { deps, ticketRepo, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    ticketRepo.findOneBy.mockResolvedValue({ id: 7, guildId: 'guild1', channelId: 'chan1', status: 'closed' });

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledTimes(1);
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.alreadyClosed);
    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
  });

  test('workflow throws → reverts status to original and notifies (no stranded close)', async () => {
    const { deps, ticketRepo, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    archiveAndCloseTicket.mockRejectedValue(new Error('transient DB error'));

    await ticketCloseEvent(client, makeInteraction(), deps);

    // First update flips to 'closed' (conditionally — the race fix), second
    // reverts to the original 'opened'.
    expect(ticketRepo.update).toHaveBeenCalledTimes(2);
    expect(ticketRepo.update).toHaveBeenNthCalledWith(
      1,
      { id: 7, guildId: 'guild1', status: Not('closed') },
      { status: 'closed' },
    );
    // Revert is conditional too — only un-closes the row while it's still
    // 'closed' (a concurrent status change must not be clobbered).
    expect(ticketRepo.update).toHaveBeenNthCalledWith(
      2,
      { id: 7, guildId: 'guild1', status: 'closed' },
      { status: 'opened' },
    );
    expect(replyEphemeralError).toHaveBeenCalledTimes(1);
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.transcriptCreate.error);
  });

  test('archive returns archived:false → reverts status and notifies', async () => {
    const { deps, ticketRepo, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    archiveAndCloseTicket.mockResolvedValue({ success: false, archived: false, transcriptFailed: true });

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(ticketRepo.update).toHaveBeenCalledTimes(2);
    expect(ticketRepo.update).toHaveBeenNthCalledWith(
      2,
      { id: 7, guildId: 'guild1', status: 'closed' },
      { status: 'opened' },
    );
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.transcriptCreate.error);
  });

  test('happy path → marks closed once, archives, no error feedback', async () => {
    const { deps, ticketRepo, archiveAndCloseTicket, replyEphemeralError } = makeDeps();

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(archiveAndCloseTicket).toHaveBeenCalledTimes(1);
    // The clicking user is threaded as the CloseActor (7th arg) so the
    // archive header renders "Closed by" — v3.16.0
    expect(archiveAndCloseTicket.mock.calls[0][6]).toEqual({ id: 'user1', username: 'closer-user' });
    expect(ticketRepo.update).toHaveBeenCalledTimes(1);
    expect(ticketRepo.update).toHaveBeenCalledWith(
      { id: 7, guildId: 'guild1', status: Not('closed') },
      { status: 'closed' },
    );
    expect(replyEphemeralError).not.toHaveBeenCalled();
  });

  test('flip race lost (affected=0) → treated as duplicate close, no archive attempt', async () => {
    const { deps, ticketRepo, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    ticketRepo.update.mockResolvedValue({ affected: 0 });

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(archiveAndCloseTicket).not.toHaveBeenCalled();
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.alreadyClosed);
  });

  test('archived but channel delete failed → notifies user instead of leaving a live channel hanging', async () => {
    const { deps, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    archiveAndCloseTicket.mockResolvedValue({ success: true, archived: true, channelDeleted: false });

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledTimes(1);
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.archivedChannelRemains, expect.anything());
  });

  test('archived and channel deleted → clean success, no notice', async () => {
    const { deps, archiveAndCloseTicket, replyEphemeralError } = makeDeps();
    archiveAndCloseTicket.mockResolvedValue({ success: true, archived: true, channelDeleted: true });

    await ticketCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).not.toHaveBeenCalled();
  });
});
