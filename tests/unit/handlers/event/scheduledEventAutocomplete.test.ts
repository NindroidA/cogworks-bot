/**
 * scheduledEventAutocomplete unit tests — the /event cancel + /event remind
 * 'event' option picker, wired for the first time in v3.14.3.
 */

import { describe, expect, test } from 'bun:test';
import { scheduledEventAutocomplete } from '../../../../src/commands/handlers/event/create';

function makeInteraction(opts: { events?: Array<{ id: string; name: string }>; focused?: string; noGuild?: boolean }) {
  const responses: Array<Array<{ name: string; value: string }>> = [];
  const collection = new Map((opts.events ?? []).map(e => [e.id, e]));
  const interaction = {
    guild: opts.noGuild
      ? null
      : {
          scheduledEvents: {
            fetch: async () => ({
              filter: (fn: (e: { id: string; name: string }) => boolean) => {
                const kept = new Map([...collection.entries()].filter(([, e]) => fn(e)));
                return { values: () => kept.values() };
              },
              values: () => collection.values(),
            }),
          },
        },
    options: { getFocused: () => opts.focused ?? '' },
    respond: async (choices: Array<{ name: string; value: string }>) => {
      responses.push(choices);
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: minimal AutocompleteInteraction test double
  return { interaction: interaction as any, responses };
}

describe('scheduledEventAutocomplete', () => {
  test('suggests live scheduled events as name → id choices', async () => {
    const { interaction, responses } = makeInteraction({
      events: [
        { id: 'e1', name: 'Movie Night' },
        { id: 'e2', name: 'Game Tournament' },
      ],
    });
    await scheduledEventAutocomplete(interaction);
    expect(responses).toEqual([
      [
        { name: 'Movie Night', value: 'e1' },
        { name: 'Game Tournament', value: 'e2' },
      ],
    ]);
  });

  test('filters by the focused value, case-insensitively', async () => {
    const { interaction, responses } = makeInteraction({
      events: [
        { id: 'e1', name: 'Movie Night' },
        { id: 'e2', name: 'Game Tournament' },
      ],
      focused: 'movie',
    });
    await scheduledEventAutocomplete(interaction);
    expect(responses).toEqual([[{ name: 'Movie Night', value: 'e1' }]]);
  });

  test('no guild → empty response', async () => {
    const { interaction, responses } = makeInteraction({ noGuild: true });
    await scheduledEventAutocomplete(interaction);
    expect(responses).toEqual([[]]);
  });

  test('fetch failure → empty response, no throw', async () => {
    const { interaction, responses } = makeInteraction({});
    interaction.guild.scheduledEvents.fetch = async () => {
      throw new Error('Missing Access');
    };
    await scheduledEventAutocomplete(interaction);
    expect(responses).toEqual([[]]);
  });
});
