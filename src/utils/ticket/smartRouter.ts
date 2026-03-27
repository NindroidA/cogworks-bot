/**
 * Ticket Smart Routing System
 *
 * Auto-assigns tickets to staff based on type-to-role mapping,
 * workload balancing, and availability (online/idle presence).
 *
 * NOTE: Requires the following columns on TicketConfig (added separately):
 *   - smartRoutingEnabled: boolean (default false)
 *   - routingRules: simple-json (RoutingRule[])
 *   - routingStrategy: string ('round-robin' | 'least-load' | 'random', default 'least-load')
 */

import type { Guild, GuildMember } from 'discord.js';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { lazyRepo } from '../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

// ============================================================================
// Types
// ============================================================================

export interface RoutingRule {
  /** The custom ticket type ID (e.g., 'bug_report', 'ban_appeal') */
  ticketTypeId: string;
  /** Discord role ID for the staff group that handles this type */
  staffRoleId: string;
  /** Maximum open assigned tickets per staff member (optional cap) */
  maxOpen?: number;
}

export type RoutingStrategy = 'round-robin' | 'least-load' | 'random';

export interface RoutingResult {
  /** The selected staff member, or null if no one is available */
  member: GuildMember | null;
  /** Reason if no member was selected */
  reason?: 'no-rule' | 'no-online-staff' | 'all-at-capacity';
  /** The routing rule that was matched (if any) */
  matchedRule?: RoutingRule;
}

export interface StaffWorkloadEntry {
  memberId: string;
  openTickets: number;
}

// ============================================================================
// In-memory round-robin state (keyed by guildId:roleId)
// ============================================================================

const roundRobinIndex = new Map<string, number>();

function getRoundRobinKey(guildId: string, roleId: string): string {
  return `${guildId}:${roleId}`;
}

/**
 * Advance and return the round-robin index for a given guild + role pair.
 * Wraps around when the index exceeds the member count.
 */
function nextRoundRobinIndex(guildId: string, roleId: string, memberCount: number): number {
  const key = getRoundRobinKey(guildId, roleId);
  const current = roundRobinIndex.get(key) ?? 0;
  const index = current % memberCount;
  roundRobinIndex.set(key, (current + 1) % memberCount);
  return index;
}

/**
 * Reset round-robin state for a guild (e.g., when routing is disabled).
 */
export function resetRoundRobin(guildId: string): void {
  for (const key of roundRobinIndex.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      roundRobinIndex.delete(key);
    }
  }
}

// ============================================================================
// Core routing logic
// ============================================================================

const ticketRepo = lazyRepo(Ticket);

/**
 * Route a newly created ticket to a staff member based on the guild's
 * routing rules, strategy, and staff availability.
 *
 * @param guild - The Discord guild
 * @param ticketTypeId - The ticket's custom type ID (or legacy type string)
 * @param routingRules - The guild's configured routing rules
 * @param strategy - The routing strategy to use
 * @returns RoutingResult with the selected member or a reason for failure
 */
export async function routeTicket(
  guild: Guild,
  ticketTypeId: string | null,
  routingRules: RoutingRule[],
  strategy: RoutingStrategy,
): Promise<RoutingResult> {
  // 1. Find matching rule for this ticket type
  if (!ticketTypeId) {
    return { member: null, reason: 'no-rule' };
  }

  const rule = routingRules.find(r => r.ticketTypeId === ticketTypeId);
  if (!rule) {
    return { member: null, reason: 'no-rule' };
  }

  // 2. Get online members with the staff role
  const onlineStaff = await getOnlineStaffWithRole(guild, rule.staffRoleId);
  if (onlineStaff.length === 0) {
    enhancedLogger.info('Smart routing: no online staff for role', LogCategory.SYSTEM, {
      guildId: guild.id,
      roleId: rule.staffRoleId,
      ticketTypeId,
    });
    return { member: null, reason: 'no-online-staff', matchedRule: rule };
  }

  // 3. Get workload for online staff
  const workload = await getStaffWorkload(guild.id, onlineStaff);

  // 4. Filter by max capacity (if configured)
  let eligibleStaff = onlineStaff;
  if (rule.maxOpen != null && rule.maxOpen > 0) {
    const workloadMap = new Map(workload.map(w => [w.memberId, w.openTickets]));
    eligibleStaff = onlineStaff.filter(m => {
      const openCount = workloadMap.get(m.id) ?? 0;
      return openCount < rule.maxOpen!;
    });

    if (eligibleStaff.length === 0) {
      enhancedLogger.info('Smart routing: all staff at capacity', LogCategory.SYSTEM, {
        guildId: guild.id,
        roleId: rule.staffRoleId,
        ticketTypeId,
        maxOpen: rule.maxOpen,
      });
      return { member: null, reason: 'all-at-capacity', matchedRule: rule };
    }
  }

  // 5. Apply strategy
  const selected = applyStrategy(guild.id, rule.staffRoleId, eligibleStaff, workload, strategy);

  enhancedLogger.info('Smart routing: ticket routed', LogCategory.SYSTEM, {
    guildId: guild.id,
    ticketTypeId,
    strategy,
    selectedMember: selected?.id,
    eligibleCount: eligibleStaff.length,
  });

  return { member: selected ?? null, matchedRule: rule };
}

// ============================================================================
// Staff availability
// ============================================================================

/**
 * Get guild members with a specific role who are currently online or idle.
 * Members with 'dnd' or 'offline' status are excluded.
 */
async function getOnlineStaffWithRole(guild: Guild, roleId: string): Promise<GuildMember[]> {
  try {
    // Fetch members with the role (uses cache if available)
    const role = guild.roles.cache.get(roleId);
    if (!role) return [];

    // Filter to online/idle presences
    return role.members
      .filter(member => {
        if (member.user.bot) return false;
        const presence = member.presence;
        if (!presence) return false;
        return presence.status === 'online' || presence.status === 'idle';
      })
      .map(m => m);
  } catch (error) {
    enhancedLogger.error('Failed to fetch online staff', error as Error, LogCategory.ERROR, {
      guildId: guild.id,
      roleId,
    });
    return [];
  }
}

// ============================================================================
// Workload tracking
// ============================================================================

/**
 * Count the number of open (non-closed) assigned tickets per staff member
 * in a given guild.
 *
 * @param guildId - The guild ID
 * @param staffMembers - The staff members to check workload for
 * @returns Array of workload entries sorted by openTickets ascending
 */
export async function getStaffWorkload(guildId: string, staffMembers: GuildMember[]): Promise<StaffWorkloadEntry[]> {
  if (staffMembers.length === 0) return [];

  const memberIds = staffMembers.map(m => m.id);

  try {
    // Count open assigned tickets per staff member
    const results = await ticketRepo
      .createQueryBuilder('ticket')
      .select('ticket.assignedTo', 'assignedTo')
      .addSelect('COUNT(*)', 'count')
      .where('ticket.guildId = :guildId', { guildId })
      .andWhere('ticket.status != :closed', { closed: 'closed' })
      .andWhere('ticket.assignedTo IN (:...memberIds)', { memberIds })
      .groupBy('ticket.assignedTo')
      .getRawMany<{ assignedTo: string; count: string }>();

    const countMap = new Map(
      results.map((r: { assignedTo: string; count: string }) => [r.assignedTo, parseInt(r.count, 10)]),
    );

    return memberIds
      .map(id => ({
        memberId: id,
        openTickets: countMap.get(id) ?? 0,
      }))
      .sort((a, b) => a.openTickets - b.openTickets);
  } catch (error) {
    enhancedLogger.error('Failed to query staff workload', error as Error, LogCategory.DATABASE, {
      guildId,
    });
    // Fallback: assume zero workload for everyone
    return memberIds.map(id => ({ memberId: id, openTickets: 0 }));
  }
}

// ============================================================================
// Strategy application
// ============================================================================

function applyStrategy(
  guildId: string,
  roleId: string,
  eligibleStaff: GuildMember[],
  workload: StaffWorkloadEntry[],
  strategy: RoutingStrategy,
): GuildMember | undefined {
  if (eligibleStaff.length === 0) return undefined;

  switch (strategy) {
    case 'least-load': {
      // Pick the staff member with fewest open tickets
      const workloadMap = new Map(workload.map(w => [w.memberId, w.openTickets]));
      const sorted = [...eligibleStaff].sort((a, b) => {
        const aLoad = workloadMap.get(a.id) ?? 0;
        const bLoad = workloadMap.get(b.id) ?? 0;
        return aLoad - bLoad;
      });
      return sorted[0];
    }

    case 'round-robin': {
      // Sort by ID for consistent ordering, then pick next in rotation
      const sorted = [...eligibleStaff].sort((a, b) => a.id.localeCompare(b.id));
      const index = nextRoundRobinIndex(guildId, roleId, sorted.length);
      return sorted[index];
    }

    case 'random': {
      const index = Math.floor(Math.random() * eligibleStaff.length);
      return eligibleStaff[index];
    }

    default:
      return eligibleStaff[0];
  }
}
