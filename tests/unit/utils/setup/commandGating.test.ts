import { describe, expect, test } from 'bun:test';
import { commands } from '../../../../src/commands/commandList';
import {
  __COMMAND_MODULE,
  type GatedModule,
  isCommandVisible,
} from '../../../../src/utils/setup/commandGating';

/**
 * Command-gating unit tests — the pure visibility decision and the
 * command→module map. The DB-backed resolver and Discord registration are
 * exercised at runtime; here we lock down the gating logic that decides which
 * commands appear in a guild's picker.
 */

const ALL_MODULES: GatedModule[] = ['tickets', 'applications', 'announcements', 'memory', 'xp', 'baitchannel'];

function commandName(cmd: (typeof commands)[number]): string | undefined {
  const c = cmd as { toJSON?: () => { name: string }; name?: string };
  return typeof c.toJSON === 'function' ? c.toJSON().name : c.name;
}

describe('isCommandVisible', () => {
  const none = new Set<GatedModule>();
  const all = new Set<GatedModule>(ALL_MODULES);

  test('meta/utility commands are always visible regardless of enabled modules', () => {
    for (const name of ['ping', 'coffee', 'role', 'server', 'dashboard', 'status', 'archive', 'import', 'data-export']) {
      expect(isCommandVisible(name, none)).toBe(true);
    }
  });

  test('every *-setup command is always visible (the re-enable path)', () => {
    for (const name of [
      'bot-setup',
      'bot-reset',
      'ticket-setup',
      'application-setup',
      'announcement-setup',
      'memory-setup',
      'xp-setup',
      'rules-setup',
    ]) {
      expect(isCommandVisible(name, none)).toBe(true);
    }
  });

  test('single-command modules without a separate setup path are intentionally NOT gated', () => {
    // Hiding these would strand admins (no always-visible re-enable path).
    for (const name of ['starboard', 'event', 'onboarding', 'analytics', 'automod', 'reactionrole']) {
      expect(isCommandVisible(name, none)).toBe(true);
    }
  });

  test('XP commands are hidden when xp is disabled and shown when enabled', () => {
    for (const name of ['rank', 'leaderboard', 'xp']) {
      expect(isCommandVisible(name, none)).toBe(false);
      expect(isCommandVisible(name, new Set<GatedModule>(['xp']))).toBe(true);
    }
  });

  test('ticket commands (incl. context menus) gate on the tickets module', () => {
    for (const name of ['ticket', 'Open Ticket For User', 'Manage Restrictions']) {
      expect(isCommandVisible(name, none)).toBe(false);
      expect(isCommandVisible(name, new Set<GatedModule>(['tickets']))).toBe(true);
    }
  });

  test('memory commands (incl. context menu) gate on the memory module', () => {
    for (const name of ['memory', 'Capture to Memory']) {
      expect(isCommandVisible(name, none)).toBe(false);
      expect(isCommandVisible(name, new Set<GatedModule>(['memory']))).toBe(true);
    }
  });

  test('baitchannel command + context menu gate on the baitchannel module', () => {
    for (const name of ['baitchannel', 'View Bait Score']) {
      expect(isCommandVisible(name, none)).toBe(false);
      expect(isCommandVisible(name, new Set<GatedModule>(['baitchannel']))).toBe(true);
    }
  });

  test('application and announcement commands gate on their modules', () => {
    expect(isCommandVisible('application', none)).toBe(false);
    expect(isCommandVisible('application', new Set<GatedModule>(['applications']))).toBe(true);
    expect(isCommandVisible('announcement', none)).toBe(false);
    expect(isCommandVisible('announcement', new Set<GatedModule>(['announcements']))).toBe(true);
  });

  test('with all modules enabled, every command is visible', () => {
    for (const cmd of commands) {
      const name = commandName(cmd);
      if (name) expect(isCommandVisible(name, all)).toBe(true);
    }
  });

  test('one enabled module does not unhide a different module', () => {
    const onlyXp = new Set<GatedModule>(['xp']);
    expect(isCommandVisible('ticket', onlyXp)).toBe(false);
    expect(isCommandVisible('baitchannel', onlyXp)).toBe(false);
    expect(isCommandVisible('rank', onlyXp)).toBe(true);
  });
});

describe('COMMAND_MODULE map integrity', () => {
  test('every mapped command name is a real registered command (catches renames)', () => {
    const realNames = new Set(commands.map(commandName).filter(Boolean));
    for (const key of Object.keys(__COMMAND_MODULE)) {
      expect(realNames.has(key)).toBe(true);
    }
  });

  test('every mapped module is a known GatedModule', () => {
    for (const mod of Object.values(__COMMAND_MODULE)) {
      expect(ALL_MODULES).toContain(mod);
    }
  });
});
