/**
 * /application info, status and workflow-add-status (v3.16.32).
 *
 * - info put the last 5 internal notes (up to 1000 chars each) in one embed
 *   field, which holds 1024: one long note made every info call throw.
 * - A custom workflow status `closed` hid the application from every lookup
 *   (they skip status 'closed'), so it could never be closed or archived.
 *
 * The handlers' repos are real Repository instances, so they are stubbed on the
 * prototype. The member is a Discord admin, which passes the feature guard
 * without touching the database.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { Repository } from 'typeorm';
import {
  applicationInfoHandler,
  applicationStatusHandler,
  applicationWorkflowAddStatusHandler,
  applicationWorkflowStatusAutocomplete,
} from '../../../../src/commands/handlers/application/workflow';

function makeInteraction(options: Record<string, string | null> = {}) {
  const interaction = {
    guildId: 'guild-app-wf',
    guild: {},
    channelId: 'chan1',
    channel: { id: 'chan1', send: jest.fn().mockResolvedValue(undefined) },
    user: { id: 'staff1', username: 'staffer' },
    member: { permissions: { has: () => true }, roles: { cache: new Map() } },
    options: { getString: (name: string) => options[name] ?? null },
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: jest.fn(async (_payload: unknown) => {
      interaction.replied = true;
    }),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

const replyText = (interaction: ReturnType<typeof makeInteraction>) =>
  JSON.stringify(interaction.reply.mock.calls[0]?.[0] ?? null);

let application: Record<string, unknown>;
let findOneBy: ReturnType<typeof jest.spyOn>;
let createQueryBuilder: ReturnType<typeof jest.spyOn>;
let save: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  application = { id: 7, guildId: 'guild-app-wf', channelId: 'chan1', createdBy: 'u1', status: 'opened' };
  findOneBy = jest
    .spyOn(Repository.prototype, 'findOneBy')
    .mockResolvedValue({ guildId: 'guild-app-wf', enableWorkflow: true, workflowStatuses: null } as never);
  createQueryBuilder = jest.spyOn(Repository.prototype, 'createQueryBuilder').mockImplementation((() => {
    const qb = { where: () => qb, andWhere: () => qb, getOne: async () => application };
    return qb;
  }) as never);
  save = jest.spyOn(Repository.prototype, 'save').mockResolvedValue(undefined as never);
});

afterEach(() => {
  findOneBy.mockRestore();
  createQueryBuilder.mockRestore();
  save.mockRestore();
});

describe('/application info', () => {
  test('five 1000-char notes still fit the notes field', async () => {
    application.internalNotes = Array.from({ length: 5 }, (_, i) => ({
      note: String(i).repeat(1000),
      addedBy: '123456789012345678',
      addedAt: new Date().toISOString(),
    }));
    const interaction = makeInteraction();

    await applicationInfoHandler(interaction as never);

    const payload = interaction.reply.mock.calls[0][0] as { embeds: { toJSON: () => { fields: { name: string; value: string }[] } }[] };
    const notes = payload.embeds[0].toJSON().fields.find(f => f.name.startsWith('Internal Notes'));
    expect(notes?.value.length).toBeLessThanOrEqual(1024);
    expect(notes?.value.split('\n')).toHaveLength(5);
    expect(notes?.value).toContain('…');
  });
});

describe('reserved status ids', () => {
  test('workflow-add-status refuses `closed`', async () => {
    const interaction = makeInteraction({ id: 'closed', label: 'Closed' });

    await applicationWorkflowAddStatusHandler(interaction as never);

    expect(replyText(interaction)).toContain('is a status the bot sets itself');
    expect(save).not.toHaveBeenCalled();
  });

  test('status refuses `closed` even when a guild already saved it as a custom status', async () => {
    findOneBy.mockResolvedValue({
      guildId: 'guild-app-wf',
      enableWorkflow: true,
      workflowStatuses: [{ id: 'closed', label: 'Closed', emoji: '🔒', color: '#000000' }],
    } as never);
    const interaction = makeInteraction({ status: 'closed' });

    await applicationStatusHandler(interaction as never);

    expect(replyText(interaction)).toContain('is a status the bot sets itself');
    expect(save).not.toHaveBeenCalled();
    expect(application.status).toBe('opened');
  });

  test('the status picker leaves out a saved `closed` status', async () => {
    findOneBy.mockResolvedValue({
      guildId: 'guild-app-wf',
      enableWorkflow: true,
      workflowStatuses: [
        { id: 'submitted', label: 'Submitted', emoji: '📥', color: '#000000' },
        { id: 'closed', label: 'Closed', emoji: '🔒', color: '#000000' },
      ],
    } as never);
    const respond = jest.fn(async (_choices: { name: string; value: string }[]) => {});

    await applicationWorkflowStatusAutocomplete({ guildId: 'guild-app-wf', respond });

    expect(respond.mock.calls[0][0].map(c => c.value)).toEqual(['submitted']);
  });
});
