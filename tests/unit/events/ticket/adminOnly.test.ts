/**
 * ticketAdminOnlyEvent regression tests — pins the v3.13.2 rewrite that had
 * shipped untested: the creator-request branch (requestSent ack, staff act on
 * it), the null-globalStaffRole guard (used to ping a literal "undefined"),
 * per-role permission-failure tolerance, and the frozen-ack fix for a missing
 * ticket.
 */

import { describe, expect, jest, test } from 'bun:test';
import ticketLang from '../../../../src/lang/en/ticket.json';
import generalLang from '../../../../src/lang/en/general.json';
import { type AdminOnlyDeps, ticketAdminOnlyEventImpl as ticketAdminOnlyEvent } from '../../../../src/events/ticket/adminOnly';

const tl = ticketLang.adminOnly;

function makeDeps(overrides: Partial<Record<keyof AdminOnlyDeps, unknown>> = {}) {
  const ticketRepo = {
    findOneBy: jest
      .fn()
      .mockResolvedValue({ id: 3, guildId: 'guild1', channelId: 'chan1', createdBy: 'creator-1', messageId: 'welcome-1' }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const ticketConfigRepo = { findOneBy: jest.fn().mockResolvedValue({ adminOnlyMentionStaff: true }) };
  const getBotConfig = jest.fn().mockResolvedValue({ enableGlobalStaffRole: true, globalStaffRole: '<@&staff-role>' });
  const getStaffRoles = jest.fn().mockResolvedValue([{ role: '<@&staff-role>' }]);
  const replyEphemeralError = jest.fn().mockResolvedValue(undefined);
  return {
    deps: {
      ticketRepo,
      ticketConfigRepo,
      getBotConfig,
      getStaffRoles,
      replyEphemeralError,
      ...overrides,
    } as unknown as AdminOnlyDeps,
    ticketRepo,
    ticketConfigRepo,
    getBotConfig,
    getStaffRoles,
    replyEphemeralError,
  };
}

function makeInteraction(userId = 'staff-9') {
  const sent: Array<{ content: string }> = [];
  const edits: Array<{ content?: string }> = [];
  const permEdits: Array<{ roleId: string; perms: unknown }> = [];
  const welcomeEdits: unknown[] = [];
  const permissionOverwrites = {
    edit: jest.fn(async (roleId: string, perms: unknown) => {
      permEdits.push({ roleId, perms });
    }),
  };
  const interaction = {
    guildId: 'guild1',
    channelId: 'chan1',
    user: { id: userId, displayName: 'Somebody' },
    channel: {
      send: async (payload: { content: string }) => {
        sent.push(payload);
      },
      permissionOverwrites,
      messages: {
        fetch: async () => ({
          edit: async (payload: unknown) => {
            welcomeEdits.push(payload);
          },
        }),
      },
    },
    editReply: async (payload: { content?: string }) => {
      edits.push(payload);
    },
  } as never;
  return { interaction, sent, edits, permEdits, welcomeEdits, permissionOverwrites };
}

const client = {} as never;

describe('ticketAdminOnlyEvent', () => {
  test('missing ticket → visible error instead of a frozen "Changing..." ack', async () => {
    const { deps, ticketRepo, replyEphemeralError } = makeDeps();
    ticketRepo.findOneBy.mockResolvedValue(null);
    const { interaction } = makeInteraction();

    await ticketAdminOnlyEvent(client, interaction, deps);

    expect(replyEphemeralError).toHaveBeenCalledWith(expect.anything(), generalLang.fatalError, { bugReport: true });
  });

  test('creator click = a REQUEST: staff pinged, requestSent ack, status untouched', async () => {
    const { deps, ticketRepo } = makeDeps();
    const { interaction, sent, edits, permEdits } = makeInteraction('creator-1');

    await ticketAdminOnlyEvent(client, interaction, deps);

    expect(sent).toHaveLength(1);
    expect(sent[0].content.startsWith('<@&staff-role>')).toBe(true);
    expect(edits).toEqual([{ content: tl.requestSent }]);
    // The creator requests — staff perform. Nothing changes yet.
    expect(ticketRepo.update).not.toHaveBeenCalled();
    expect(permEdits).toHaveLength(0);
  });

  test('creator request with NO configured staff role never pings a literal "undefined"', async () => {
    const { deps, getBotConfig } = makeDeps();
    // No globalStaffRole key at all — the historical bug interpolated the
    // missing value, so the regression renders the literal string "undefined".
    getBotConfig.mockResolvedValue({ enableGlobalStaffRole: true });
    const { interaction, sent } = makeInteraction('creator-1');

    await ticketAdminOnlyEvent(client, interaction, deps);

    expect(sent).toHaveLength(1);
    expect(sent[0].content).not.toContain('undefined');
    expect(sent[0].content).not.toContain('null');
    expect(sent[0].content.startsWith(tl.modsAlert)).toBe(true);
  });

  test('creator request honors adminOnlyMentionStaff=false (no role ping)', async () => {
    const { deps, ticketConfigRepo } = makeDeps();
    ticketConfigRepo.findOneBy.mockResolvedValue({ adminOnlyMentionStaff: false });
    const { interaction, sent } = makeInteraction('creator-1');

    await ticketAdminOnlyEvent(client, interaction, deps);

    expect(sent[0].content).not.toContain('<@&staff-role>');
  });

  test('staff click: hides valid staff roles, skips malformed ones, flips status, success ack', async () => {
    const { deps, getStaffRoles, ticketRepo } = makeDeps();
    getStaffRoles.mockResolvedValue([{ role: '<@&111>' }, { role: 'not-a-mention' }, { role: '<@&222>' }]);
    const { interaction, edits, permEdits, welcomeEdits } = makeInteraction('staff-9');

    await ticketAdminOnlyEvent(client, interaction, deps);

    expect(permEdits.map(p => p.roleId)).toEqual(['111', '222']);
    expect(welcomeEdits).toHaveLength(1); // Admin Only button stripped
    expect(ticketRepo.update).toHaveBeenCalledWith({ id: 3, guildId: 'guild1' }, { status: 'adminOnly' });
    expect(edits).toEqual([{ content: tl.success }]);
  });

  test('one role failing to hide does not abort the rest or strand the interaction', async () => {
    const { deps, getStaffRoles, ticketRepo } = makeDeps();
    getStaffRoles.mockResolvedValue([{ role: '<@&111>' }, { role: '<@&222>' }]);
    const { interaction, edits, permEdits, permissionOverwrites } = makeInteraction('staff-9');
    permissionOverwrites.edit.mockImplementationOnce(async () => {
      throw new Error('Missing Permissions');
    });

    await ticketAdminOnlyEvent(client, interaction, deps);

    // role 111 threw, role 222 still processed; status + ack still happen.
    expect(permEdits.map(p => p.roleId)).toEqual(['222']);
    expect(ticketRepo.update).toHaveBeenCalledTimes(1);
    expect(edits).toEqual([{ content: tl.success }]);
  });
});
