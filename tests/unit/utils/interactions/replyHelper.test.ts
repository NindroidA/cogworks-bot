/**
 * replyEphemeralError unit tests — verifies the reply/editReply/followUp routing
 * and the prefix/bugReport options. Pure: fake interaction objects, no Discord.
 */

import { describe, expect, jest, test } from 'bun:test';
import { replyEphemeralError } from '../../../../src/utils/interactions/replyHelper';

type FakeInteraction = {
  replied: boolean;
  deferred: boolean;
  reply: ReturnType<typeof jest.fn>;
  editReply: ReturnType<typeof jest.fn>;
  followUp: ReturnType<typeof jest.fn>;
};

function fakeInteraction(state: { replied?: boolean; deferred?: boolean } = {}): FakeInteraction {
  return {
    replied: state.replied ?? false,
    deferred: state.deferred ?? false,
    reply: jest.fn(async () => undefined),
    editReply: jest.fn(async () => undefined),
    followUp: jest.fn(async () => undefined),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: fake interaction stands in for RepliableInteraction in tests
const asInteraction = (i: FakeInteraction) => i as any;

describe('replyEphemeralError', () => {
  test('fresh interaction → reply, ephemeral flag, error-emoji prefix', async () => {
    const i = fakeInteraction();
    await replyEphemeralError(asInteraction(i), 'boom');
    expect(i.reply).toHaveBeenCalledTimes(1);
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).not.toHaveBeenCalled();
    const arg = i.reply.mock.calls[0][0];
    expect(arg.content).toBe('❌ boom');
    expect(Array.isArray(arg.flags)).toBe(true);
  });

  test('deferred interaction → editReply with NO flags (defer already ephemeral)', async () => {
    const i = fakeInteraction({ deferred: true });
    await replyEphemeralError(asInteraction(i), 'boom');
    expect(i.editReply).toHaveBeenCalledTimes(1);
    expect(i.reply).not.toHaveBeenCalled();
    const arg = i.editReply.mock.calls[0][0];
    expect(arg.content).toBe('❌ boom');
    expect(arg.flags).toBeUndefined();
  });

  test('already-replied interaction → followUp, ephemeral', async () => {
    const i = fakeInteraction({ replied: true });
    await replyEphemeralError(asInteraction(i), 'boom');
    expect(i.followUp).toHaveBeenCalledTimes(1);
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.followUp.mock.calls[0][0].content).toBe('❌ boom');
  });

  test('prefix:false → no emoji prefix', async () => {
    const i = fakeInteraction();
    await replyEphemeralError(asInteraction(i), 'raw message', { prefix: false });
    expect(i.reply.mock.calls[0][0].content).toBe('raw message');
  });

  test('bugReport:true → wraps with the bug-report link (and still prefixes)', async () => {
    const i = fakeInteraction();
    await replyEphemeralError(asInteraction(i), 'oops', { bugReport: true });
    const content = i.reply.mock.calls[0][0].content as string;
    expect(content.startsWith('❌ oops')).toBe(true);
    expect(content).toContain('support server');
  });

  test('swallows a delivery failure instead of throwing', async () => {
    const i = fakeInteraction({ deferred: true });
    i.editReply.mockImplementation(async () => {
      throw new Error('Unknown interaction');
    });
    // Must not reject.
    await expect(replyEphemeralError(asInteraction(i), 'boom')).resolves.toBeUndefined();
  });
});
