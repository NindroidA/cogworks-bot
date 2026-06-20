/**
 * Builder option factory unit tests.
 *
 * The factories are pure over a fresh option builder, so these drive them with
 * standalone option instances and assert on the exact `.toJSON()` shape. The
 * required-presence cases matter most: omitting `required` must leave the field
 * off the JSON (distinct from an explicit `required: false`), since that is what
 * keeps the generated command JSON identical to the hand-written option blocks.
 */

import { describe, expect, test } from 'bun:test';
import { ChannelType, SlashCommandChannelOption, SlashCommandStringOption } from 'discord.js';
import {
  createActionOption,
  createForumChannelOption,
  createTextChannelOption,
} from '../../../../src/commands/builders/factories';

describe('createTextChannelOption', () => {
  test('defaults the name to "channel" and restricts to GuildText', () => {
    const json = createTextChannelOption(new SlashCommandChannelOption(), {
      description: 'desc',
      required: true,
    }).toJSON();
    expect(json.name).toBe('channel');
    expect(json.description).toBe('desc');
    expect(json.required).toBe(true);
    expect(json.channel_types).toEqual([ChannelType.GuildText]);
  });

  test('honours a custom option name', () => {
    const json = createTextChannelOption(new SlashCommandChannelOption(), {
      name: 'log_channel',
      description: 'd',
    }).toJSON();
    expect(json.name).toBe('log_channel');
  });

  test('leaves setRequired uncalled when not provided, matching a bare option block', () => {
    // discord.js serialises an option that never called setRequired the same as
    // one set to false, so omitting `required` reproduces the original bare
    // `.addChannelTypes(...)` blocks (e.g. bait log_channel / summary channel).
    const omitted = createTextChannelOption(new SlashCommandChannelOption(), { description: 'd' }).toJSON();
    const explicitFalse = createTextChannelOption(new SlashCommandChannelOption(), {
      description: 'd',
      required: false,
    }).toJSON();
    expect(omitted).toEqual(explicitFalse);
  });

  test('emits required:true when explicitly true', () => {
    const json = createTextChannelOption(new SlashCommandChannelOption(), {
      description: 'd',
      required: true,
    }).toJSON();
    expect(json.required).toBe(true);
  });
});

describe('createForumChannelOption', () => {
  test('restricts to GuildForum', () => {
    const json = createForumChannelOption(new SlashCommandChannelOption(), {
      name: 'archive',
      description: 'd',
      required: false,
    }).toJSON();
    expect(json.name).toBe('archive');
    expect(json.channel_types).toEqual([ChannelType.GuildForum]);
    expect(json.required).toBe(false);
  });
});

describe('createActionOption', () => {
  test('builds a required "action" option with the given choices', () => {
    const json = createActionOption(new SlashCommandStringOption(), {
      description: 'pick one',
      choices: [
        { name: 'Add', value: 'add' },
        { name: 'Remove', value: 'remove' },
        { name: 'List', value: 'list' },
      ],
    }).toJSON();
    expect(json.name).toBe('action');
    expect(json.description).toBe('pick one');
    expect(json.required).toBe(true);
    expect(json.choices).toEqual([
      { name: 'Add', value: 'add' },
      { name: 'Remove', value: 'remove' },
      { name: 'List', value: 'list' },
    ]);
  });

  test('required defaults to true but can be overridden', () => {
    const json = createActionOption(new SlashCommandStringOption(), {
      description: 'd',
      choices: [{ name: 'A', value: 'a' }],
      required: false,
    }).toJSON();
    expect(json.required).toBe(false);
  });
});
