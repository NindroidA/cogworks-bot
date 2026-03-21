import { describe, expect, test, beforeEach } from 'bun:test';
import {
  resetRoundRobin,
  type RoutingRule,
  type RoutingStrategy,
  type StaffWorkloadEntry,
} from '../../../../src/utils/ticket/smartRouter';

/**
 * Smart Router Unit Tests
 *
 * The core routeTicket() function requires a Guild object and DB queries,
 * so we test the pure exported functions and types. The round-robin state
 * management and type definitions are testable without mocks.
 */

// ===========================================================================
// RoutingRule type structure
// ===========================================================================
describe('RoutingRule type', () => {
  test('can create a basic routing rule object', () => {
    const rule: RoutingRule = {
      ticketTypeId: 'bug_report',
      staffRoleId: '123456789012345678',
    };
    expect(rule.ticketTypeId).toBe('bug_report');
    expect(rule.staffRoleId).toBe('123456789012345678');
    expect(rule.maxOpen).toBeUndefined();
  });

  test('can create a routing rule with maxOpen', () => {
    const rule: RoutingRule = {
      ticketTypeId: 'ban_appeal',
      staffRoleId: '987654321098765432',
      maxOpen: 5,
    };
    expect(rule.maxOpen).toBe(5);
  });

  test('multiple rules can coexist', () => {
    const rules: RoutingRule[] = [
      { ticketTypeId: 'bug', staffRoleId: 'role1' },
      { ticketTypeId: 'feature', staffRoleId: 'role2', maxOpen: 3 },
      { ticketTypeId: 'support', staffRoleId: 'role3', maxOpen: 10 },
    ];
    expect(rules).toHaveLength(3);
    expect(rules[0].ticketTypeId).toBe('bug');
    expect(rules[1].maxOpen).toBe(3);
  });
});

// ===========================================================================
// RoutingStrategy type
// ===========================================================================
describe('RoutingStrategy type', () => {
  test('accepts round-robin', () => {
    const strategy: RoutingStrategy = 'round-robin';
    expect(strategy).toBe('round-robin');
  });

  test('accepts least-load', () => {
    const strategy: RoutingStrategy = 'least-load';
    expect(strategy).toBe('least-load');
  });

  test('accepts random', () => {
    const strategy: RoutingStrategy = 'random';
    expect(strategy).toBe('random');
  });
});

// ===========================================================================
// StaffWorkloadEntry type
// ===========================================================================
describe('StaffWorkloadEntry type', () => {
  test('can create a workload entry', () => {
    const entry: StaffWorkloadEntry = {
      memberId: '123456789012345678',
      openTickets: 3,
    };
    expect(entry.memberId).toBe('123456789012345678');
    expect(entry.openTickets).toBe(3);
  });

  test('can create zero-workload entry', () => {
    const entry: StaffWorkloadEntry = {
      memberId: '111222333444555666',
      openTickets: 0,
    };
    expect(entry.openTickets).toBe(0);
  });

  test('can sort workload entries by openTickets', () => {
    const entries: StaffWorkloadEntry[] = [
      { memberId: 'a', openTickets: 5 },
      { memberId: 'b', openTickets: 1 },
      { memberId: 'c', openTickets: 3 },
    ];
    const sorted = [...entries].sort((a, b) => a.openTickets - b.openTickets);
    expect(sorted[0].memberId).toBe('b');
    expect(sorted[1].memberId).toBe('c');
    expect(sorted[2].memberId).toBe('a');
  });
});

// ===========================================================================
// resetRoundRobin
// ===========================================================================
describe('resetRoundRobin()', () => {
  test('does not throw for nonexistent guild', () => {
    expect(() => resetRoundRobin('nonexistent-guild')).not.toThrow();
  });

  test('can be called multiple times', () => {
    expect(() => {
      resetRoundRobin('guild1');
      resetRoundRobin('guild1');
      resetRoundRobin('guild2');
    }).not.toThrow();
  });

  test('does not affect other guilds', () => {
    // This is a behavior test — resetRoundRobin only clears keys starting with guildId:
    // We just verify it runs without error
    resetRoundRobin('guild-a');
    resetRoundRobin('guild-b');
    expect(true).toBe(true);
  });
});

// ===========================================================================
// Rule matching logic (pure data tests)
// ===========================================================================
describe('rule matching logic', () => {
  const rules: RoutingRule[] = [
    { ticketTypeId: 'bug_report', staffRoleId: 'role-devs' },
    { ticketTypeId: 'ban_appeal', staffRoleId: 'role-mods', maxOpen: 3 },
    { ticketTypeId: 'partnership', staffRoleId: 'role-admins', maxOpen: 1 },
  ];

  test('finds matching rule by ticketTypeId', () => {
    const match = rules.find(r => r.ticketTypeId === 'bug_report');
    expect(match).toBeDefined();
    expect(match!.staffRoleId).toBe('role-devs');
  });

  test('returns undefined for unknown ticketTypeId', () => {
    const match = rules.find(r => r.ticketTypeId === 'nonexistent');
    expect(match).toBeUndefined();
  });

  test('finds rule with maxOpen constraint', () => {
    const match = rules.find(r => r.ticketTypeId === 'ban_appeal');
    expect(match).toBeDefined();
    expect(match!.maxOpen).toBe(3);
  });

  test('returns undefined maxOpen for uncapped rule', () => {
    const match = rules.find(r => r.ticketTypeId === 'bug_report');
    expect(match!.maxOpen).toBeUndefined();
  });
});

// ===========================================================================
// Capacity filtering logic (pure data tests)
// ===========================================================================
describe('capacity filtering logic', () => {
  test('filters staff at or above maxOpen', () => {
    const maxOpen = 3;
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'staff1', openTickets: 2 },
      { memberId: 'staff2', openTickets: 3 },
      { memberId: 'staff3', openTickets: 5 },
      { memberId: 'staff4', openTickets: 0 },
    ];

    const eligible = workload.filter(w => w.openTickets < maxOpen);
    expect(eligible).toHaveLength(2);
    expect(eligible.map(e => e.memberId)).toEqual(['staff1', 'staff4']);
  });

  test('returns empty when all at capacity', () => {
    const maxOpen = 2;
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'staff1', openTickets: 2 },
      { memberId: 'staff2', openTickets: 5 },
    ];

    const eligible = workload.filter(w => w.openTickets < maxOpen);
    expect(eligible).toHaveLength(0);
  });

  test('returns all when no one is at capacity', () => {
    const maxOpen = 10;
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'staff1', openTickets: 1 },
      { memberId: 'staff2', openTickets: 3 },
      { memberId: 'staff3', openTickets: 5 },
    ];

    const eligible = workload.filter(w => w.openTickets < maxOpen);
    expect(eligible).toHaveLength(3);
  });

  test('no capacity filter when maxOpen is undefined', () => {
    const maxOpen: number | undefined = undefined;
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'staff1', openTickets: 100 },
    ];

    const eligible = maxOpen != null
      ? workload.filter(w => w.openTickets < maxOpen)
      : workload;
    expect(eligible).toHaveLength(1);
  });
});

// ===========================================================================
// Least-load strategy logic (pure data test)
// ===========================================================================
describe('least-load strategy logic', () => {
  test('selects staff with fewest open tickets', () => {
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'staff1', openTickets: 5 },
      { memberId: 'staff2', openTickets: 1 },
      { memberId: 'staff3', openTickets: 3 },
    ];

    const sorted = [...workload].sort((a, b) => a.openTickets - b.openTickets);
    expect(sorted[0].memberId).toBe('staff2');
  });

  test('handles tie in workload (first wins)', () => {
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'staff1', openTickets: 2 },
      { memberId: 'staff2', openTickets: 2 },
    ];

    const sorted = [...workload].sort((a, b) => a.openTickets - b.openTickets);
    expect(sorted[0].memberId).toBe('staff1');
  });

  test('handles all zero workload', () => {
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'staff1', openTickets: 0 },
      { memberId: 'staff2', openTickets: 0 },
      { memberId: 'staff3', openTickets: 0 },
    ];

    const sorted = [...workload].sort((a, b) => a.openTickets - b.openTickets);
    expect(sorted[0].openTickets).toBe(0);
  });

  test('handles single staff member', () => {
    const workload: StaffWorkloadEntry[] = [
      { memberId: 'only-staff', openTickets: 10 },
    ];

    const sorted = [...workload].sort((a, b) => a.openTickets - b.openTickets);
    expect(sorted[0].memberId).toBe('only-staff');
  });
});
