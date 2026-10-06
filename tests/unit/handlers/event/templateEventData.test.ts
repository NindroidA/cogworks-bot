/**
 * Template events (v3.16.32): voice and stage templates never passed a
 * channel, so /event from-template and /event recurring always failed for
 * them. The `channel` option now supplies it, and its type picks voice or stage.
 */

import { describe, expect, test } from 'bun:test';
import { ChannelType, GuildScheduledEventEntityType } from 'discord.js';
import { templateEventData } from '../../../../src/commands/handlers/event/create';
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
