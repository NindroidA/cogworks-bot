/**
 * routeInteraction safety-net tests.
 *
 * The dispatch chain acknowledges interactions (reply/update/defer) inside the
 * feature handlers, so a throw AFTER acknowledgement used to become an
 * unhandled rejection — Discord shows no "interaction failed" and the user is
 * stranded on a stale loading state forever. The router now wraps the dispatch
 * loop in try/catch and surfaces an ephemeral error. These tests lock that in,
 * plus the existing short-circuit / non-component contract.
 *
 * The dispatcher list is injected via routeInteraction's optional 3rd arg so we
 * can drive a throwing/short-circuiting dispatcher deterministically.
 */

import { describe, expect, jest, test } from 'bun:test';
import { routeInteraction } from '../../../src/events/interactionRouter';

function makeButton() {
  return {
    customId: 'some_button',
    replied: true,
    deferred: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  } as never;
}

const client = {} as never;

describe('routeInteraction', () => {
  test('a dispatcher that throws after ack does NOT reject and surfaces an ephemeral error', async () => {
    const interaction = makeButton();
    const throwing = jest.fn(async () => {
      throw new Error('handler blew up after interaction.update');
    });

    // Must not reject — an unhandled rejection here is the permanent-hang bug.
    await expect(routeInteraction(client, interaction, [throwing as never])).resolves.toBeUndefined();

    expect(throwing).toHaveBeenCalledTimes(1);
    // interaction.replied === true → replyEphemeralError follows up ephemerally.
    expect((interaction as unknown as { followUp: ReturnType<typeof jest.fn> }).followUp).toHaveBeenCalledTimes(1);
  });

  test('first dispatcher returning true short-circuits the rest', async () => {
    const interaction = makeButton();
    const first = jest.fn(async () => true);
    const second = jest.fn(async () => true);

    await routeInteraction(client, interaction, [first as never, second as never]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  test('falls through every dispatcher when none claims the interaction', async () => {
    const interaction = makeButton();
    const a = jest.fn(async () => false);
    const b = jest.fn(async () => false);

    await routeInteraction(client, interaction, [a as never, b as never]);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('non-component interactions are ignored (no dispatchers run)', async () => {
    const autocomplete = {
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
    } as never;
    const dispatcher = jest.fn(async () => true);

    await routeInteraction(client, autocomplete, [dispatcher as never]);

    expect(dispatcher).not.toHaveBeenCalled();
  });
});
