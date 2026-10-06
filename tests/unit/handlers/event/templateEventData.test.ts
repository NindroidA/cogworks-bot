/**
 * Template events (v3.16.32): voice and stage templates never passed a
 * channel, so /event from-template and /event recurring always failed for
 * them. The `channel` option now supplies it, and its type picks voice or stage.
 *
 * /event recurring: once the first event exists, a failure saving the template
 * is a warning, not "failed", so the admin doesn't retry into a second series.
 * Its repos are real Repository instances, stubbed on the prototype.
 */

import { afterEach, describe, expect, jest, test } from 'bun:test';
import { ChannelType, GuildScheduledEventEntityType } from 'discord.js';
import { Repository } from 'typeorm';
import { handleRecurring, templateEventData } from '../../../../src/commands/handlers/event/create';
import type { EventTemplate } from '../../../../src/typeorm/entities/event/EventTemplate';

const start = new Date('2030-01-01T18:00:00Z');
const end = new Date('2030-01-01T19:00:00Z');
const template = (entityType: string) =>
  ({
    title: 'Game night',
    description: null,
    entityType,
    location: null,
  }) as unknown as EventTemplate;

describe('templateEventData', () => {
  test('external templates keep their location and need no channel', () => {
    expect(templateEventData(template('external'), start, end, null)).toMatchObject({
      name: 'Game night',
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: 'TBD' },
    });
  });

  test('a voice or stage template without a channel is refused before calling Discord', () => {
    expect(templateEventData(template('voice'), start, end, null)).toBeNull();
    expect(templateEventData(template('stage'), start, end, null)).toBeNull();
  });

  test("the channel's type decides voice or stage", () => {
    const voice = { id: '400000000000000001', type: ChannelType.GuildVoice };
    const stage = { id: '400000000000000002', type: ChannelType.GuildStageVoice };
    expect(templateEventData(template('voice'), start, end, voice)).toMatchObject({
      entityType: GuildScheduledEventEntityType.Voice,
      channel: voice.id,
    });
    expect(templateEventData(template('voice'), start, end, stage)).toMatchObject({
      entityType: GuildScheduledEventEntityType.StageInstance,
      channel: stage.id,
    });
  });
});

describe('/event recurring', () => {
  const spies: ReturnType<typeof jest.spyOn>[] = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  test('a failure after the event exists is a partial-success warning', async () => {
    spies.push(
      jest.spyOn(Repository.prototype, 'findOneBy').mockImplementation((async (where: Record<string, unknown>) =>
        'name' in where
          ? { ...template('external'), name: 'game-night', defaultDurationMinutes: 60 }
          : { guildId: 'g1', enabled: true, reminderChannelId: null, defaultReminderMinutes: 0 }) as never),
      jest.spyOn(Repository.prototype, 'save').mockRejectedValue(new Error('db down') as never),
    );
    const create = jest.fn(async () => ({ id: '200000000000000001' }));
    const options: Record<string, string> = { template: 'game-night', start: '2099-01-01 3:00 PM', pattern: 'weekly' };
    const interaction = {
      guildId: 'g1',
      guild: { scheduledEvents: { create } },
      member: { permissions: { has: () => true } },
      user: { id: 'u1' },
      isRepliable: () => true,
      options: { getString: (name: string) => options[name], getChannel: () => null },
      replied: false,
      deferred: false,
      deferReply: jest.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: jest.fn(async (_payload: { content: string }) => {}),
      reply: jest.fn(async () => {}),
    };

    await handleRecurring({} as never, interaction as never);

    expect(create).toHaveBeenCalledTimes(1);
    const content = interaction.editReply.mock.calls[0][0].content;
    expect(content).toContain('The first **Game night** event was created');
    expect(content).not.toContain('Failed to create recurring event');
  });
});
