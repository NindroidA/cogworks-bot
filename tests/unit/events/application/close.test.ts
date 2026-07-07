/**
 * applicationCloseEvent regression tests — the application twin of
 * tests/unit/events/ticket/close.test.ts.
 *
 * The handler carries the full v3.13.x close-hang fix set (guard feedback,
 * atomic status flip, revert-on-throw, revert-on-archived:false,
 * channelDeleted:false notice) but had zero coverage until v3.15.2 because it
 * lacked an injectable seam. These tests lock in that EVERY exit surfaces
 * user feedback and that a failed close reverts the status conditionally
 * instead of stranding the application 'closed' with a live channel.
 */

import { describe, expect, jest, test } from 'bun:test';
import { Not } from 'typeorm';
import {
  type ApplicationCloseDeps,
  applicationCloseEventImpl as applicationCloseEvent,
} from '../../../../src/events/application/close';
import applicationLang from '../../../../src/lang/en/application.json';

const tl = applicationLang.close;

function makeDeps(overrides: Partial<Record<keyof ApplicationCloseDeps, unknown>> = {}) {
  const archivedApplicationConfigRepo = { findOneBy: jest.fn().mockResolvedValue({ channelId: 'forum-1' }) };
  const applicationRepo = {
    findOneBy: jest.fn().mockResolvedValue({ id: 9, guildId: 'guild1', channelId: 'chan1', status: 'pending' }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const archiveAndCloseApplication = jest.fn().mockResolvedValue({ success: true, archived: true });
  const replyEphemeralError = jest.fn().mockResolvedValue(undefined);
  return {
    deps: {
      archivedApplicationConfigRepo,
      applicationRepo,
      archiveAndCloseApplication,
      replyEphemeralError,
      ...overrides,
    } as unknown as ApplicationCloseDeps,
    archivedApplicationConfigRepo,
    applicationRepo,
    archiveAndCloseApplication,
    replyEphemeralError,
  };
}

function makeInteraction() {
  return {
    guildId: 'guild1',
    channelId: 'chan1',
    channel: { id: 'chan1' },
    user: { id: 'user1', username: 'closer-user' },
  } as never;
}

const client = {} as never;

describe('applicationCloseEvent', () => {
  test('no archive config → notConfigured feedback, no archive attempt', async () => {
    const { deps, archivedApplicationConfigRepo, archiveAndCloseApplication, replyEphemeralError } = makeDeps();
    archivedApplicationConfigRepo.findOneBy.mockResolvedValue(null);

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.notConfigured);
    expect(archiveAndCloseApplication).not.toHaveBeenCalled();
  });

  test('no application row → notFound feedback', async () => {
    const { deps, applicationRepo, archiveAndCloseApplication, replyEphemeralError } = makeDeps();
    applicationRepo.findOneBy.mockResolvedValue(null);

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.notFound);
    expect(archiveAndCloseApplication).not.toHaveBeenCalled();
  });

  test('already closed → alreadyClosed feedback, no archive attempt', async () => {
    const { deps, applicationRepo, archiveAndCloseApplication, replyEphemeralError } = makeDeps();
    applicationRepo.findOneBy.mockResolvedValue({ id: 9, guildId: 'guild1', channelId: 'chan1', status: 'closed' });

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.alreadyClosed);
    expect(archiveAndCloseApplication).not.toHaveBeenCalled();
  });

  test('flip race lost (affected=0) → treated as duplicate close, no archive attempt', async () => {
    const { deps, applicationRepo, archiveAndCloseApplication, replyEphemeralError } = makeDeps();
    applicationRepo.update.mockResolvedValue({ affected: 0 });

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(archiveAndCloseApplication).not.toHaveBeenCalled();
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.alreadyClosed);
  });

  test('happy path → single atomic flip, archives, no error feedback', async () => {
    const { deps, applicationRepo, archiveAndCloseApplication, replyEphemeralError } = makeDeps();

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(archiveAndCloseApplication).toHaveBeenCalledTimes(1);
    // The clicking user is threaded as the CloseActor (7th arg) so the
    // archive header renders "Closed by" — v3.16.0
    expect(archiveAndCloseApplication.mock.calls[0][6]).toEqual({ id: 'user1', username: 'closer-user' });
    expect(applicationRepo.update).toHaveBeenCalledTimes(1);
    expect(applicationRepo.update).toHaveBeenCalledWith(
      { id: 9, guildId: 'guild1', status: Not('closed') },
      { status: 'closed' },
    );
    expect(replyEphemeralError).not.toHaveBeenCalled();
  });

  test('workflow throws → conditional revert to original status and notifies (no stranded close)', async () => {
    const { deps, applicationRepo, archiveAndCloseApplication, replyEphemeralError } = makeDeps();
    archiveAndCloseApplication.mockRejectedValue(new Error('transient DB error'));

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(applicationRepo.update).toHaveBeenCalledTimes(2);
    expect(applicationRepo.update).toHaveBeenNthCalledWith(
      2,
      { id: 9, guildId: 'guild1', status: 'closed' },
      { status: 'pending' },
    );
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.transcriptCreate.error);
  });

  test('archive returns archived:false → conditional revert and notifies', async () => {
    const { deps, applicationRepo, archiveAndCloseApplication, replyEphemeralError } = makeDeps();
    archiveAndCloseApplication.mockResolvedValue({ success: false, archived: false, transcriptFailed: true });

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(applicationRepo.update).toHaveBeenCalledTimes(2);
    expect(applicationRepo.update).toHaveBeenNthCalledWith(
      2,
      { id: 9, guildId: 'guild1', status: 'closed' },
      { status: 'pending' },
    );
    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.transcriptCreate.error);
  });

  test('archived but channel delete failed → notifies instead of leaving a live channel hanging', async () => {
    const { deps, archiveAndCloseApplication, replyEphemeralError } = makeDeps();
    archiveAndCloseApplication.mockResolvedValue({ success: true, archived: true, channelDeleted: false });

    await applicationCloseEvent(client, makeInteraction(), deps);

    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), tl.archivedChannelRemains, {
      bugReport: true,
    });
  });
});
