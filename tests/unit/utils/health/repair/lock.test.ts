import { describe, expect, test } from 'bun:test';
import { RepairBusyError, tryLockGuildRepair } from '../../../../../src/utils/health/repair/lock';

describe('tryLockGuildRepair', () => {
  test('one holder per guild; other guilds are independent', () => {
    const release = tryLockGuildRepair('lock-a');
    expect(release).toBeFunction();
    expect(tryLockGuildRepair('lock-a')).toBeNull();
    const other = tryLockGuildRepair('lock-b');
    expect(other).toBeFunction();
    release?.();
    other?.();
  });

  test('release frees the guild, and a second release never frees a later holder', () => {
    const first = tryLockGuildRepair('lock-c');
    first?.();
    const second = tryLockGuildRepair('lock-c');
    expect(second).toBeFunction();
    first?.();
    expect(tryLockGuildRepair('lock-c')).toBeNull();
    second?.();
    const third = tryLockGuildRepair('lock-c');
    expect(third).toBeFunction();
    third?.();
  });

  test('RepairBusyError names the guild', () => {
    const error = new RepairBusyError('lock-d');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RepairBusyError');
    expect(error.guildId).toBe('lock-d');
  });
});
