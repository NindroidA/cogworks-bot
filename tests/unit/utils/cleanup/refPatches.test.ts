/**
 * refPatches unit tests.
 *
 * The patches are pure, so these call them directly on plain rows: no
 * repositories, no module mocks. The delete-event suites cover the cleaners
 * that apply them (and must pass unchanged, which proves the move didn't drift).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REF_PATCHES, type RefKind, type RefPatchFn } from '../../../../src/utils/cleanup/refPatches';
import { MAX } from '../../../../src/utils/constants';
import type { OnboardingRoleOption, OnboardingStepDef } from '../../../../src/utils/onboarding/types';

const ID = 'gone-1';
const OTHER = 'still-here';

type Fixture = { hit: object; miss: object };

/** A full onboarding step: role-select when it has options, a plain message otherwise. */
function step(id: string, options?: OnboardingRoleOption[]): OnboardingStepDef {
  return {
    id,
    type: options ? 'role-select' : 'message',
    title: id,
    description: '',
    required: false,
    ...(options ? { options } : {}),
  };
}

/**
 * One row per table entry that references ID (`hit`) and one that only
 * references other ids (`miss`). Keys must match REF_PATCHES exactly.
 */
const FIXTURES: Record<RefKind, Record<string, Fixture>> = {
  channel: {
    Ticket: {
      hit: { channelId: ID, status: 'opened', statusHistory: [{ status: 'opened', changedBy: 'u1', changedAt: 't0' }] },
      miss: { channelId: OTHER, status: 'opened', statusHistory: null },
    },
    Application: {
      hit: { channelId: ID, status: 'pending', statusHistory: null },
      miss: { channelId: OTHER, status: 'pending', statusHistory: null },
    },
    TicketConfig: {
      hit: { channelId: ID, messageId: 'm1', categoryId: ID, slaBreachChannelId: ID },
      miss: { channelId: OTHER, messageId: 'm1', categoryId: OTHER, slaBreachChannelId: null },
    },
    ArchivedTicketConfig: {
      hit: { channelId: ID, messageId: 'm1' },
      miss: { channelId: OTHER, messageId: 'm1' },
    },
    ApplicationConfig: {
      hit: { channelId: ID, messageId: 'm1', categoryId: ID },
      miss: { channelId: OTHER, messageId: 'm1', categoryId: null },
    },
    ArchivedApplicationConfig: {
      hit: { channelId: ID, messageId: 'm1' },
      miss: { channelId: OTHER, messageId: 'm1' },
    },
    RulesConfig: { hit: { channelId: ID }, miss: { channelId: OTHER } },
    ReactionRoleMenu: { hit: { channelId: ID }, miss: { channelId: OTHER } },
    MemoryConfig: { hit: { forumChannelId: ID }, miss: { forumChannelId: OTHER } },
    AnnouncementConfig: { hit: { defaultChannelId: ID }, miss: { defaultChannelId: OTHER } },
    StarboardConfig: {
      hit: { enabled: true, channelId: ID, ignoredChannels: [OTHER, ID] },
      miss: { enabled: true, channelId: OTHER, ignoredChannels: [OTHER] },
    },
    XPConfig: {
      hit: { levelUpChannelId: ID, ignoredChannels: [ID, OTHER], multiplierChannels: { [ID]: 2, [OTHER]: 1.5 } },
      miss: { levelUpChannelId: OTHER, ignoredChannels: [OTHER], multiplierChannels: { [OTHER]: 1.5 } },
    },
  },
  role: {
    BotConfig: {
      hit: { globalStaffRole: ID, enableGlobalStaffRole: true },
      miss: { globalStaffRole: OTHER, enableGlobalStaffRole: true },
    },
    ReactionRoleOption: { hit: { roleId: ID }, miss: { roleId: OTHER } },
    AnnouncementConfig: { hit: { defaultRoleId: ID }, miss: { defaultRoleId: OTHER } },
    StaffRole: { hit: { role: ID }, miss: { role: OTHER } },
    XPConfig: { hit: { ignoredRoles: [OTHER, ID] }, miss: { ignoredRoles: [OTHER] } },
    XPRoleReward: { hit: { roleId: ID }, miss: { roleId: OTHER } },
    OnboardingConfig: {
      hit: {
        completionRoleId: ID,
        steps: [step('s1', [{ label: 'Gone', roleId: ID }]), step('s2')],
      },
      miss: {
        completionRoleId: OTHER,
        steps: [step('s1', [{ label: 'Kept', roleId: OTHER }])],
      },
    },
  },
  message: {
    TicketConfig: { hit: { channelId: 'c1', messageId: ID }, miss: { channelId: 'c1', messageId: OTHER } },
    ArchivedTicketConfig: { hit: { channelId: 'c1', messageId: ID }, miss: { channelId: 'c1', messageId: OTHER } },
    ApplicationConfig: { hit: { channelId: 'c1', messageId: ID }, miss: { channelId: 'c1', messageId: OTHER } },
    ArchivedApplicationConfig: {
      hit: { channelId: 'c1', messageId: ID },
      miss: { channelId: 'c1', messageId: OTHER },
    },
    RulesConfig: { hit: { messageId: ID }, miss: { messageId: OTHER } },
    ReactionRoleMenu: { hit: { messageId: ID }, miss: { messageId: OTHER } },
    MemoryConfig: { hit: { messageId: ID }, miss: { messageId: OTHER } },
  },
  thread: {
    MemoryItem: { hit: { threadId: ID, title: 'Note' }, miss: { threadId: OTHER, title: 'Note' } },
  },
};

const KINDS: RefKind[] = ['channel', 'role', 'message', 'thread'];

/** Every table entry, typed loosely so the fixtures can drive it. */
function entries(): Array<[RefKind, string, RefPatchFn]> {
  return KINDS.flatMap(kind =>
    Object.entries(REF_PATCHES[kind] as Record<string, RefPatchFn>).map(
      ([entity, patch]) => [kind, entity, patch] as [RefKind, string, RefPatchFn],
    ),
  );
}

/** A fresh copy of a fixture row, so a patch that mutates can't change what later tests see. */
function fixture(kind: RefKind, entity: string, which: keyof Fixture): object {
  return structuredClone(FIXTURES[kind][entity][which]);
}

describe('REF_PATCHES table', () => {
  test('converts exactly the cleaners that have a health check', () => {
    expect(Object.keys(REF_PATCHES.channel).sort()).toEqual(
      [
        'Application',
        'Ticket',
        'AnnouncementConfig',
        'ApplicationConfig',
        'ArchivedApplicationConfig',
        'ArchivedTicketConfig',
        'MemoryConfig',
        'ReactionRoleMenu',
        'RulesConfig',
        'StarboardConfig',
        'TicketConfig',
        'XPConfig',
      ].sort(),
    );
    // RulesConfig (role) and TicketConfig (routing rules) stay inline
    expect(Object.keys(REF_PATCHES.role).sort()).toEqual(
      [
        'AnnouncementConfig',
        'BotConfig',
        'OnboardingConfig',
        'ReactionRoleOption',
        'StaffRole',
        'XPConfig',
        'XPRoleReward',
      ].sort(),
    );
    // Every message cleaner except BaitChannelConfig
    expect(Object.keys(REF_PATCHES.message).sort()).toEqual(
      [
        'ApplicationConfig',
        'ArchivedApplicationConfig',
        'ArchivedTicketConfig',
        'MemoryConfig',
        'ReactionRoleMenu',
        'RulesConfig',
        'TicketConfig',
      ].sort(),
    );
    expect(Object.keys(REF_PATCHES.thread)).toEqual(['MemoryItem']);
  });

  test('loads without the DataSource: type-only entity imports plus two leaf helpers', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'utils', 'cleanup', 'refPatches.ts'), 'utf8');
    const runtimeImports = [...source.matchAll(/^import (?!type )[^;]*? from '([^']+)';/gm)].map(m => m[1]);

    expect(runtimeImports.sort()).toEqual(['../constants', '../workflow/workflowHelpers']);
  });

  test('every entry has a fixture (and every fixture an entry)', () => {
    for (const kind of KINDS) {
      expect(Object.keys(FIXTURES[kind]).sort()).toEqual(Object.keys(REF_PATCHES[kind]).sort());
    }
  });

  test.each(entries())('%s %s: null when nothing references the id', (kind, entity, patch) => {
    expect(patch(fixture(kind, entity, 'miss'), ID)).toBeNull();
  });

  test.each(entries())('%s %s: a patch when the row references the id', (kind, entity, patch) => {
    expect(patch(fixture(kind, entity, 'hit'), ID)).not.toBeNull();
  });

  test.each(entries())('%s %s: never mutates the input', (kind, entity, patch) => {
    const row = fixture(kind, entity, 'hit');
    patch(row, ID);
    // Compared, not frozen: a write to a frozen row fails silently outside strict mode
    expect(row).toStrictEqual(fixture(kind, entity, 'hit'));
  });
});

describe('channel patches', () => {
  test('TicketConfig: the panel channel takes its message; category and SLA channel clear separately', () => {
    const { TicketConfig } = REF_PATCHES.channel;
    const row = { channelId: 'panel', messageId: 'm1', categoryId: 'cat', slaBreachChannelId: 'sla' };

    expect(TicketConfig(row, 'panel')).toEqual({ set: { channelId: '', messageId: '' } });
    expect(TicketConfig(row, 'cat')).toEqual({ set: { categoryId: null } });
    expect(TicketConfig(row, 'sla')).toEqual({ set: { slaBreachChannelId: null } });
  });

  test('ApplicationConfig: panel channel and category', () => {
    const { ApplicationConfig } = REF_PATCHES.channel;
    const row = { channelId: 'panel', messageId: 'm1', categoryId: 'cat' };

    expect(ApplicationConfig(row, 'panel')).toEqual({ set: { channelId: '', messageId: '' } });
    expect(ApplicationConfig(row, 'cat')).toEqual({ set: { categoryId: null } });
  });

  test('archive configs clear the channel and its message', () => {
    const row = { channelId: ID, messageId: 'm1' };
    expect(REF_PATCHES.channel.ArchivedTicketConfig(row, ID)).toEqual({ set: { channelId: '', messageId: '' } });
    expect(REF_PATCHES.channel.ArchivedApplicationConfig(row, ID)).toEqual({ set: { channelId: '', messageId: '' } });
  });

  test('AnnouncementConfig: default channel becomes empty', () => {
    expect(REF_PATCHES.channel.AnnouncementConfig({ defaultChannelId: ID }, ID)).toEqual({
      set: { defaultChannelId: '' },
    });
  });

  test('StarboardConfig: losing the board channel disables it; an ignored channel is dropped', () => {
    const { StarboardConfig } = REF_PATCHES.channel;

    expect(StarboardConfig({ channelId: ID, ignoredChannels: null }, ID)).toEqual({
      set: { enabled: false, channelId: '' },
    });
    expect(StarboardConfig({ channelId: 'board', ignoredChannels: ['a', ID, 'b'] }, ID)).toEqual({
      set: { ignoredChannels: ['a', 'b'] },
    });
  });

  test('XPConfig: level-up channel, ignored list and multiplier map in one patch', () => {
    const row = { levelUpChannelId: ID, ignoredChannels: [ID, 'keep'], multiplierChannels: { [ID]: 2, keep: 1.5 } };

    expect(REF_PATCHES.channel.XPConfig(row, ID)).toEqual({
      set: { levelUpChannelId: null, ignoredChannels: ['keep'], multiplierChannels: { keep: 1.5 } },
    });
  });

  test('XPConfig: the multiplier map becomes null when its last key goes', () => {
    const row = { levelUpChannelId: null, ignoredChannels: null, multiplierChannels: { [ID]: 2 } };

    expect(REF_PATCHES.channel.XPConfig(row, ID)).toEqual({ set: { multiplierChannels: null } });
  });

  test('XPConfig: a multiplier of 0 still counts as a reference', () => {
    const row = { levelUpChannelId: null, ignoredChannels: null, multiplierChannels: { [ID]: 0, keep: 1 } };

    expect(REF_PATCHES.channel.XPConfig(row, ID)).toEqual({ set: { multiplierChannels: { keep: 1 } } });
  });

  test('RulesConfig: removed with no cascade', () => {
    expect(REF_PATCHES.channel.RulesConfig({ channelId: ID }, ID)).toEqual({ remove: true });
  });

  test('MemoryConfig: remove declares its cascade, items then tags', () => {
    expect(REF_PATCHES.channel.MemoryConfig({ forumChannelId: ID }, ID)).toEqual({
      remove: true,
      cascade: [
        { entity: 'MemoryItem', column: 'memoryConfigId' },
        { entity: 'MemoryTag', column: 'memoryConfigId' },
      ],
    });
  });

  test('ReactionRoleMenu: remove declares its options as the cascade', () => {
    const expected = { remove: true, cascade: [{ entity: 'ReactionRoleOption', column: 'menuId' }] };
    expect(REF_PATCHES.channel.ReactionRoleMenu({ channelId: ID }, ID)).toEqual(expected);
    expect(REF_PATCHES.message.ReactionRoleMenu({ messageId: ID }, ID)).toEqual(expected);
  });
});

describe('ticket and application close', () => {
  const close = [
    ['Ticket', REF_PATCHES.channel.Ticket],
    ['Application', REF_PATCHES.channel.Application],
  ] as const;

  test.each(close)('%s: an open row closes with a channel-deleted note appended', (_name, patch) => {
    const earlier = { status: 'opened', changedBy: 'u1', changedAt: '2026-10-01T00:00:00.000Z' };
    const result = patch({ channelId: ID, status: 'opened', statusHistory: [earlier] }, ID);

    expect(result?.set.status).toBe('closed');
    expect(result?.set.statusHistory).toEqual([
      earlier,
      { status: 'closed', changedBy: 'system', changedAt: expect.any(String), note: 'channel-deleted' },
    ]);
  });

  test.each(close)('%s: a row with no history gets one entry', (_name, patch) => {
    const result = patch({ channelId: ID, status: 'opened', statusHistory: null }, ID);

    expect(result?.set.statusHistory).toEqual([expect.objectContaining({ status: 'closed', note: 'channel-deleted' })]);
  });

  test.each(close)('%s: closed, accepted and rejected rows are skipped', (_name, patch) => {
    for (const status of ['closed', 'accepted', 'rejected']) {
      expect(patch({ channelId: ID, status, statusHistory: null }, ID)).toBeNull();
    }
  });

  test.each(close)('%s: a row in another channel is skipped', (_name, patch) => {
    expect(patch({ channelId: OTHER, status: 'opened', statusHistory: null }, ID)).toBeNull();
    expect(patch({ channelId: null, status: 'opened', statusHistory: null }, ID)).toBeNull();
  });

  test('history stays capped, keeping the newest entries', () => {
    const full = Array.from({ length: MAX.TICKET_STATUS_HISTORY }, (_, i) => ({
      status: 'opened',
      changedBy: `u${i}`,
      changedAt: `t${i}`,
    }));
    const result = REF_PATCHES.channel.Ticket({ channelId: ID, status: 'opened', statusHistory: full }, ID);
    const history = result?.set.statusHistory ?? [];

    expect(history).toHaveLength(MAX.TICKET_STATUS_HISTORY);
    expect(history[0]).toEqual(full[1]);
    expect(history.at(-1)).toMatchObject({ status: 'closed', note: 'channel-deleted' });
    expect(full).toHaveLength(MAX.TICKET_STATUS_HISTORY);
  });
});

describe('role patches', () => {
  test('StaffRole: matches both the raw id and the legacy <@&id> mention', () => {
    const { StaffRole } = REF_PATCHES.role;

    expect(StaffRole({ role: ID }, ID)).toEqual({ remove: true });
    expect(StaffRole({ role: `<@&${ID}>` }, ID)).toEqual({ remove: true });
    expect(StaffRole({ role: `<@&${OTHER}>` }, ID)).toBeNull();
  });

  test('BotConfig: clears the global staff role in either format and turns it off', () => {
    const { BotConfig } = REF_PATCHES.role;
    const cleared = { set: { globalStaffRole: null, enableGlobalStaffRole: false } };

    expect(BotConfig({ globalStaffRole: ID }, ID)).toEqual(cleared);
    expect(BotConfig({ globalStaffRole: `<@&${ID}>` }, ID)).toEqual(cleared);
    expect(BotConfig({ globalStaffRole: null }, ID)).toBeNull();
  });

  test('AnnouncementConfig: default role becomes null', () => {
    expect(REF_PATCHES.role.AnnouncementConfig({ defaultRoleId: ID }, ID)).toEqual({ set: { defaultRoleId: null } });
  });

  test('XPConfig: the role leaves the ignored list', () => {
    expect(REF_PATCHES.role.XPConfig({ ignoredRoles: ['a', ID, 'b'] }, ID)).toEqual({
      set: { ignoredRoles: ['a', 'b'] },
    });
    expect(REF_PATCHES.role.XPConfig({ ignoredRoles: null }, ID)).toBeNull();
  });

  test('ReactionRoleOption and XPRoleReward: removed', () => {
    expect(REF_PATCHES.role.ReactionRoleOption({ roleId: ID }, ID)).toEqual({ remove: true });
    expect(REF_PATCHES.role.XPRoleReward({ roleId: ID }, ID)).toEqual({ remove: true });
  });

  test('OnboardingConfig: drops the option from every step that offers it', () => {
    const steps = [
      step('s1', [
        { label: 'Gone', roleId: ID },
        { label: 'Kept', roleId: 'r2' },
      ]),
      step('s2'),
      step('s3', [{ label: 'Gone again', roleId: ID }]),
    ];
    const result = REF_PATCHES.role.OnboardingConfig({ completionRoleId: 'other', steps }, ID);

    expect(result).toEqual({
      set: { steps: [step('s1', [{ label: 'Kept', roleId: 'r2' }]), step('s2'), step('s3', [])] },
    });
    // A step without the role is passed through as is
    expect(result?.set.steps?.[1]).toBe(steps[1]);
  });

  test('OnboardingConfig: a completion-role match alone leaves the steps out of the patch', () => {
    const steps = [step('s1', [{ label: 'Kept', roleId: 'r2' }])];

    expect(REF_PATCHES.role.OnboardingConfig({ completionRoleId: ID, steps }, ID)).toEqual({
      set: { completionRoleId: null },
    });
  });
});

describe('message and thread patches', () => {
  test('panel and archive configs keep their channel and clear the message', () => {
    for (const entity of [
      'TicketConfig',
      'ArchivedTicketConfig',
      'ApplicationConfig',
      'ArchivedApplicationConfig',
    ] as const) {
      expect(REF_PATCHES.message[entity]({ messageId: ID }, ID)).toEqual({ set: { messageId: '' } });
    }
  });

  test('MemoryConfig: the welcome message id becomes null', () => {
    expect(REF_PATCHES.message.MemoryConfig({ messageId: ID }, ID)).toEqual({ set: { messageId: null } });
  });

  test('RulesConfig (message) and MemoryItem (thread): removed', () => {
    expect(REF_PATCHES.message.RulesConfig({ messageId: ID }, ID)).toEqual({ remove: true });
    expect(REF_PATCHES.thread.MemoryItem({ threadId: ID }, ID)).toEqual({ remove: true });
  });
});
