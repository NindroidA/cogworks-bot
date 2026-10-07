/**
 * Onboarding flow and step commands (v3.16.33).
 *
 * - sendOnboardingFlow resolves once the welcome DM is delivered; the steps run
 *   in the background, so /onboarding preview and resend can reply within the
 *   15-minute interaction token (each step waits up to 24h).
 * - A preview works while onboarding is disabled, shows every step, and saves
 *   nothing and grants no roles.
 * - A resend to a member who finished starts over from the first step.
 * - /onboarding step-remove has autocomplete, and a typed title still works.
 *
 * Repositories come from a patched AppDataSource.getRepository that returns
 * forwarding proxies: steps.ts's lazyRepo may cache one, and after this suite
 * it forwards to whatever getRepository is installed then.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { lang } from '../../../../src/lang';
import { AppDataSource } from '../../../../src/typeorm';
import { OnboardingCompletion } from '../../../../src/typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../../../src/typeorm/entities/onboarding/OnboardingConfig';

const GUILD_ID = '100000000000000001';
const USER_ID = '200000000000000001';
const COMPLETION_ROLE = '300000000000000001';
const PICKED_ROLE = '300000000000000002';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const db = {
  config: null as Record<string, any> | null,
  completion: null as Record<string, any> | null,
  saves: [] as Array<Record<string, any>>,
};

const fakes = new Map<unknown, Record<string, unknown>>([
  [
    OnboardingConfig,
    {
      findOneBy: async () => db.config,
      save: async (entity: Record<string, any>) => {
        db.config = entity;
        return entity;
      },
    },
  ],
  [
    OnboardingCompletion,
    {
      findOneBy: async () => db.completion,
      create: (data: Record<string, unknown>) => ({ completedAt: null, ...data }),
      save: async (entity: Record<string, any>) => {
        db.saves.push({ ...entity, completedSteps: [...(entity.completedSteps ?? [])] });
        db.completion = entity;
        return entity;
      },
    },
  ],
]);

type GetRepository = (entity: unknown) => unknown;
const ds = AppDataSource as unknown as { getRepository: GetRepository };
let originalGetRepository: GetRepository;
let active = false;

function forwardingRepo(entity: unknown): object {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const repo = (active ? fakes.get(entity) : ds.getRepository(entity)) as Record<string | symbol, unknown>;
        const value = repo[prop];
        return typeof value === 'function' ? value.bind(repo) : value;
      },
    },
  );
}

/** A DM message whose component collector the test drives by hand. */
function makeStepMessage() {
  const handlers: Record<string, (...args: any[]) => unknown> = {};
  const collector = {
    on(event: string, fn: (...args: any[]) => unknown) {
      handlers[event] = fn;
      return collector;
    },
    stop(reason: string) {
      handlers.end?.([], reason);
    },
  };
  return { createMessageComponentCollector: () => collector, handlers };
}

function makeMember() {
  const sent: Array<{ payload: any; message: ReturnType<typeof makeStepMessage> }> = [];
  const dm = {
    send: jest.fn(async (payload: any) => {
      const message = makeStepMessage();
      sent.push({ payload, message });
      return message;
    }),
  };
  const member = {
    id: USER_ID,
    displayName: 'Bob',
    user: { tag: 'bob#0001' },
    guild: { id: GUILD_ID, name: 'Test Server', iconURL: () => null },
    createDM: async () => dm,
    roles: { add: jest.fn(async () => undefined) },
  };
  return { member: member as never, sent, roleAdds: member.roles.add };
}

/** Click a button (or pick in a select) on the step message at `index`. */
async function click(sent: ReturnType<typeof makeMember>['sent'], index: number, customId: string, values?: string[]) {
  const interaction = {
    customId,
    values,
    isStringSelectMenu: () => values !== undefined,
    isButton: () => values === undefined,
    reply: async () => undefined,
    update: async () => undefined,
  };
  await sent[index].message.handlers.collect(interaction);
  await flush();
}

/** Let the background step chain run. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const messageStep = (id: string) => ({ id, type: 'message', title: id, description: 'Hi', required: true });
const roleStep = { id: 'roles', type: 'role-select', title: 'Roles', description: 'Pick', required: true, options: [{ label: 'Picked', roleId: PICKED_ROLE }] };

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

let sendOnboardingFlow: typeof import('../../../../src/utils/onboarding/onboardingEngine').sendOnboardingFlow;
let steps: typeof import('../../../../src/commands/handlers/onboarding/steps');

beforeAll(async () => {
  originalGetRepository = ds.getRepository;
  active = true;
  ds.getRepository = (entity: unknown) => {
    if (fakes.has(entity)) return forwardingRepo(entity);
    throw new Error(`onboardingFlow test: no fake for ${(entity as { name?: string })?.name}`);
  };
  ({ sendOnboardingFlow } = await import('../../../../src/utils/onboarding/onboardingEngine'));
  steps = await import('../../../../src/commands/handlers/onboarding/steps');
});

afterAll(() => {
  active = false;
  ds.getRepository = originalGetRepository;
});

beforeEach(() => {
  db.config = {
    guildId: GUILD_ID,
    enabled: true,
    welcomeMessage: 'Welcome to {server}!',
    completionRoleId: COMPLETION_ROLE,
    steps: [messageStep('one'), roleStep],
  };
  db.completion = null;
  db.saves = [];
});

// ---------------------------------------------------------------------------
// sendOnboardingFlow
// ---------------------------------------------------------------------------

describe('sendOnboardingFlow', () => {
  test('resolves after the welcome DM while the first step is still waiting', async () => {
    const { member, sent, roleAdds } = makeMember();

    expect(await sendOnboardingFlow(member)).toBe(true);
    await flush();

    // Welcome + step 1 sent; nothing answered yet
    expect(sent).toHaveLength(2);
    expect(db.completion?.completedAt).toBeNull();

    await click(sent, 1, 'onboarding_continue_one');
    await click(sent, 2, 'onboarding_roleselect_roles', [PICKED_ROLE]);
    await click(sent, 2, 'onboarding_confirmrole_roles');

    expect(db.completion?.completedSteps).toEqual(['one', 'roles']);
    expect(db.completion?.completedAt).toBeInstanceOf(Date);
    expect(roleAdds.mock.calls.map(c => c[0])).toEqual([PICKED_ROLE, COMPLETION_ROLE]);
  });

  test('a preview works while disabled, shows every step, and saves and grants nothing', async () => {
    db.config!.enabled = false;
    db.completion = { guildId: GUILD_ID, userId: USER_ID, completedSteps: ['one', 'roles'], completedAt: new Date() };
    const { member, sent, roleAdds } = makeMember();

    expect(await sendOnboardingFlow(member)).toBe(false); // the real flow stays off
    expect(await sendOnboardingFlow(member, { preview: true })).toBe(true);
    await flush();
    await click(sent, 1, 'onboarding_continue_one');
    await click(sent, 2, 'onboarding_roleselect_roles', [PICKED_ROLE]);
    await click(sent, 2, 'onboarding_confirmrole_roles');

    // Welcome, both steps and the closing message
    expect(sent).toHaveLength(4);
    expect(db.saves).toEqual([]);
    expect(roleAdds).not.toHaveBeenCalled();
  });

  test('a resend to a member who finished starts from the first step', async () => {
    db.completion = { guildId: GUILD_ID, userId: USER_ID, completedSteps: ['one', 'roles'], completedAt: new Date() };
    const { member, sent } = makeMember();

    await sendOnboardingFlow(member, { restart: true });
    await flush();

    expect(sent[1].payload.embeds[0].data.title).toBe('one');
    expect(db.completion?.completedAt).toBeNull();
  });

  test('a resend to a member part-way through resumes at their next step', async () => {
    db.completion = { guildId: GUILD_ID, userId: USER_ID, completedSteps: ['one'], completedAt: null };
    const { member, sent } = makeMember();

    await sendOnboardingFlow(member, { restart: true });
    await flush();

    expect(sent[1].payload.embeds[0].data.title).toBe('Roles');
  });
});

// ---------------------------------------------------------------------------
// /onboarding step-remove
// ---------------------------------------------------------------------------

function autocompleteInteraction(focused: string) {
  return { guildId: GUILD_ID, options: { getFocused: () => focused }, respond: jest.fn(async () => undefined) };
}

describe('/onboarding step-remove', () => {
  test('autocomplete lists matching steps by title, valued by id', async () => {
    const longTitle = `Read the Server Rules! ${'x'.repeat(200)}`;
    db.config!.steps = [
      { ...messageStep('read-the-server-rule'), title: longTitle },
      { ...messageStep('pick-roles'), title: 'Pick roles' },
    ];

    const all = autocompleteInteraction('');
    await steps.onboardingStepAutocomplete(all as never);
    const choices = all.respond.mock.calls[0][0] as Array<{ name: string; value: string }>;
    expect(choices.map(c => c.value)).toEqual(['read-the-server-rule', 'pick-roles']);
    expect(choices[0].name.length).toBeLessThanOrEqual(100);

    const filtered = autocompleteInteraction('PICK');
    await steps.onboardingStepAutocomplete(filtered as never);
    expect(filtered.respond.mock.calls[0][0]).toEqual([{ name: 'Pick roles', value: 'pick-roles' }]);
  });

  test('a typed title removes the step it named', async () => {
    db.config!.steps = [{ ...messageStep('read-the-server-rule'), title: 'Read the Server Rules!' }, messageStep('two')];
    const interaction = {
      guildId: GUILD_ID,
      user: { id: USER_ID },
      options: { getString: () => 'Read the Server Rules!' },
      reply: jest.fn(async () => undefined),
    };

    await steps.stepRemoveHandler({} as never, interaction as never);

    expect(db.config!.steps.map((s: { id: string }) => s.id)).toEqual(['two']);
    expect(interaction.reply.mock.calls[0][0].content).toContain('Read the Server Rules!');
  });

  test('step-list shows each step id', async () => {
    const interaction = { guildId: GUILD_ID, reply: jest.fn(async () => undefined) };

    await steps.stepListHandler({} as never, interaction as never);

    const fields = interaction.reply.mock.calls[0][0].embeds[0].data.fields as Array<{ value: string }>;
    expect(fields[0].value).toContain('`one`');
    expect(lang.onboarding.step.notFound).toContain('/onboarding step-list');
  });
});

// ---------------------------------------------------------------------------
// /onboarding completion-role
// ---------------------------------------------------------------------------

describe('/onboarding completion-role', () => {
  test('refuses a role above the invoker and keeps the old one', async () => {
    const { completionRoleHandler } = await import('../../../../src/commands/handlers/onboarding/setup');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      guildId: GUILD_ID,
      guild: {
        id: GUILD_ID,
        ownerId: '200000000000000099',
        members: {
          fetchMe: async () => ({ roles: { highest: { position: 20 } } }),
          fetch: async () => ({ roles: { highest: { position: 3 } } }),
        },
      },
      user: { id: USER_ID },
      memberPermissions: null,
      deferred: false,
      replied: false,
      isRepliable: () => true,
      options: { getRole: () => ({ id: PICKED_ROLE, managed: false, position: 5, permissions: '0' }) },
      reply,
    };

    await completionRoleHandler({} as never, interaction as never);

    expect((reply.mock.calls[0] as any[])[0].content).toContain(lang.errors.assignableRole.aboveInvoker);
    expect(db.config?.completionRoleId).toBe(COMPLETION_ROLE);
  });
});
