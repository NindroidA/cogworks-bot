/**
 * createToggleHandler unit tests.
 *
 * Drives the helper with a hand-rolled in-memory repo and a fake interaction
 * that records replies, exercising the full spine: find-or-create on enable,
 * find-only on disable, idempotent guards, the canEnable pre-guard, and the
 * onToggled side effect.
 */

import { describe, expect, test } from 'bun:test';
import { createToggleHandler } from '../../../../src/utils/interactions/toggleHandler';

interface FakeConfig {
  guildId: string;
  enabled: boolean;
  steps?: string[];
}

function makeRepo(initial: FakeConfig | null) {
  let stored = initial;
  let saveCount = 0;
  const repo = {
    findOneBy: async () => stored,
    create: (partial: Partial<FakeConfig>) => ({ enabled: false, ...partial }) as FakeConfig,
    save: async (entity: FakeConfig) => {
      stored = entity;
      saveCount += 1;
      return entity;
    },
  };
  return {
    repo,
    get stored() {
      return stored;
    },
    get saveCount() {
      return saveCount;
    },
  };
}

function makeInteraction() {
  const replies: Array<{ content?: string }> = [];
  const interaction = {
    deferred: false,
    replied: false,
    user: { id: 'user-1' },
    reply: async (opts: { content?: string }) => {
      replies.push(opts);
    },
    editReply: async (opts: { content?: string }) => {
      replies.push(opts);
    },
    followUp: async (opts: { content?: string }) => {
      replies.push(opts);
    },
  };
  return { interaction, replies };
}

const messages = {
  alreadyEnabled: 'already on',
  alreadyDisabled: 'already off',
  enabled: 'turned on',
  disabled: 'turned off',
};

// Cast helpers — the fakes implement just the slice the helper touches.
// biome-ignore lint/suspicious/noExplicitAny: test doubles for a narrow repo/interaction slice
const asRepo = (r: ReturnType<typeof makeRepo>['repo']) => r as any;
// biome-ignore lint/suspicious/noExplicitAny: test doubles for a narrow repo/interaction slice
const asInteraction = (i: ReturnType<typeof makeInteraction>['interaction']) => i as any;

describe('createToggleHandler — enable', () => {
  test('creates the config when missing, flips the flag, saves, fires onToggled, replies success', async () => {
    const r = makeRepo(null);
    const toggled: Array<boolean> = [];
    const { enable } = createToggleHandler<FakeConfig>({
      repo: asRepo(r.repo),
      field: 'enabled',
      messages,
      onToggled: (_i, _g, enabled) => {
        toggled.push(enabled);
      },
    });
    const { interaction, replies } = makeInteraction();

    await enable(asInteraction(interaction), 'g1');

    expect(r.stored).toEqual({ guildId: 'g1', enabled: true });
    expect(r.saveCount).toBe(1);
    expect(toggled).toEqual([true]);
    expect(replies.at(-1)?.content).toBe('turned on');
  });

  test('is idempotent — already enabled replies the alreadyEnabled message and does not save', async () => {
    const r = makeRepo({ guildId: 'g1', enabled: true });
    let toggledCalls = 0;
    const { enable } = createToggleHandler<FakeConfig>({
      repo: asRepo(r.repo),
      field: 'enabled',
      messages,
      onToggled: () => {
        toggledCalls += 1;
      },
    });
    const { interaction, replies } = makeInteraction();

    await enable(asInteraction(interaction), 'g1');

    expect(r.saveCount).toBe(0);
    expect(toggledCalls).toBe(0);
    expect(replies.at(-1)?.content).toContain('already on');
  });

  test('canEnable guard blocks enabling — replies the guard message, no save, no onToggled', async () => {
    const r = makeRepo({ guildId: 'g1', enabled: false });
    let toggledCalls = 0;
    const { enable } = createToggleHandler<FakeConfig>({
      repo: asRepo(r.repo),
      field: 'enabled',
      messages,
      canEnable: config => (!config.steps || config.steps.length === 0 ? 'configure steps first' : null),
      onToggled: () => {
        toggledCalls += 1;
      },
    });
    const { interaction, replies } = makeInteraction();

    await enable(asInteraction(interaction), 'g1');

    expect(r.saveCount).toBe(0);
    expect(toggledCalls).toBe(0);
    expect(replies.at(-1)?.content).toContain('configure steps first');
  });

  test('canEnable guard allows enabling when satisfied', async () => {
    const r = makeRepo({ guildId: 'g1', enabled: false, steps: ['welcome'] });
    const { enable } = createToggleHandler<FakeConfig>({
      repo: asRepo(r.repo),
      field: 'enabled',
      messages,
      canEnable: config => (!config.steps || config.steps.length === 0 ? 'configure steps first' : null),
    });
    const { interaction, replies } = makeInteraction();

    await enable(asInteraction(interaction), 'g1');

    expect(r.stored?.enabled).toBe(true);
    expect(replies.at(-1)?.content).toBe('turned on');
  });
});

describe('createToggleHandler — disable', () => {
  test('flips the flag off, saves, fires onToggled, replies success', async () => {
    const r = makeRepo({ guildId: 'g1', enabled: true });
    const toggled: Array<boolean> = [];
    const { disable } = createToggleHandler<FakeConfig>({
      repo: asRepo(r.repo),
      field: 'enabled',
      messages,
      onToggled: (_i, _g, enabled) => {
        toggled.push(enabled);
      },
    });
    const { interaction, replies } = makeInteraction();

    await disable(asInteraction(interaction), 'g1');

    expect(r.stored?.enabled).toBe(false);
    expect(r.saveCount).toBe(1);
    expect(toggled).toEqual([false]);
    expect(replies.at(-1)?.content).toBe('turned off');
  });

  test('never creates a row — disabling a missing config replies alreadyDisabled and does not save', async () => {
    const r = makeRepo(null);
    const { disable } = createToggleHandler<FakeConfig>({
      repo: asRepo(r.repo),
      field: 'enabled',
      messages,
    });
    const { interaction, replies } = makeInteraction();

    await disable(asInteraction(interaction), 'g1');

    expect(r.stored).toBeNull();
    expect(r.saveCount).toBe(0);
    expect(replies.at(-1)?.content).toContain('already off');
  });

  test('is idempotent — already disabled replies alreadyDisabled and does not save', async () => {
    const r = makeRepo({ guildId: 'g1', enabled: false });
    const { disable } = createToggleHandler<FakeConfig>({
      repo: asRepo(r.repo),
      field: 'enabled',
      messages,
    });
    const { interaction, replies } = makeInteraction();

    await disable(asInteraction(interaction), 'g1');

    expect(r.saveCount).toBe(0);
    expect(replies.at(-1)?.content).toContain('already off');
  });
});
