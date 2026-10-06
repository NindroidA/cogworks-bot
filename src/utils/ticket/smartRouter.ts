/**
 * Ticket Smart Routing System
 *
 * Auto-assigns tickets to staff based on type-to-role mapping,
 * workload balancing, and availability (online/idle presence).
 *
 * Routing column types (`RoutingRule`, `RoutingStrategy`) are owned by the
 * entity at `typeorm/entities/ticket/routingTypes.ts` and re-exported below.
 */

import { GatewayIntentBits, type Guild, type GuildMember, type Role } from 'discord.js';
import type { RoutingRule, RoutingStrategy } from '../../typeorm/entities/ticket/routingTypes';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import type { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { lazyRepo } from '../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

// Routing column types live with the entity — the runtime helper consumes
// the data shape, not the other way around. Re-exported here so existing
// util-side importers (`from '../utils/ticket/smartRouter'`) still resolve.
export type { RoutingRule, RoutingStrategy };

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
 * @param excludeMemberId - A member never to pick (the ticket's opener)
 * @returns RoutingResult with the selected member or a reason for failure
 */
export async function routeTicket(
  guild: Guild,
  ticketTypeId: string | null,
  routingRules: RoutingRule[],
  strategy: RoutingStrategy,
  excludeMemberId?: string,
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
  const onlineStaff = await getOnlineStaffWithRole(guild, rule.staffRoleId, excludeMemberId);
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

/** Guilds up to this size get a full member fetch: the member cache keeps only 200. */
const MEMBER_FETCH_MAX_GUILD_SIZE = 1000;
const MEMBER_FETCH_TIMEOUT_MS = 5_000;

/**
 * Get non-bot guild members with a specific role who are available: online or
 * idle when presence data exists. Without the privileged GuildPresences intent
 * no presence ever arrives, so every role member counts as available instead
 * of nobody.
 */
async function getOnlineStaffWithRole(guild: Guild, roleId: string, excludeMemberId?: string): Promise<GuildMember[]> {
  try {
    const role = guild.roles.cache.get(roleId);
    if (!role) return [];

    const hasPresences = guild.client.options.intents.has(GatewayIntentBits.GuildPresences);
    const members = await getRoleMembers(guild, role);
    return members.filter(member => {
      if (member.user.bot || member.id === excludeMemberId) return false;
      if (!hasPresences) return true;
      const status = member.presence?.status;
      return status === 'online' || status === 'idle';
    });
  } catch (error) {
    enhancedLogger.error('Failed to fetch online staff', error as Error, LogCategory.ERROR, {
      guildId: guild.id,
      roleId,
    });
    return [];
  }
}

/** A role's members. role.members reads the capped member cache, so small guilds fetch the full list first. */
async function getRoleMembers(guild: Guild, role: Role): Promise<GuildMember[]> {
  if (guild.memberCount <= MEMBER_FETCH_MAX_GUILD_SIZE) {
    try {
      const all = await guild.members.fetch({ time: MEMBER_FETCH_TIMEOUT_MS });
      return [...all.filter(member => member.roles.cache.has(role.id)).values()];
    } catch (error) {
      enhancedLogger.warn('Smart routing: member fetch failed, using cached role members', LogCategory.SYSTEM, {
        guildId: guild.id,
        roleId: role.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return [...role.members.values()];
}

export type TicketRoutingConfig = Pick<
  TicketConfig,
  'smartRoutingEnabled' | 'enableWorkflow' | 'routingRules' | 'routingStrategy'
>;

/**
 * Pick the staff member a new ticket is auto-assigned to, or null. Routing
 * runs only with smart routing and the workflow system enabled and at least
 * one rule. Never throws: a routing failure must not block ticket creation.
 */
export async function pickTicketAssignee(
  guild: Guild,
  ticketTypeId: string,
  config: TicketRoutingConfig,
  openerId: string,
): Promise<GuildMember | null> {
  if (!config.smartRoutingEnabled || !config.enableWorkflow || !config.routingRules?.length) return null;
  try {
    const strategy = config.routingStrategy || 'least-load';
    const result = await routeTicket(guild, ticketTypeId, config.routingRules, strategy, openerId);
    return result.member;
  } catch (error) {
    enhancedLogger.warn('Smart routing failed; ticket left unassigned', LogCategory.SYSTEM, {
      guildId: guild.id,
      ticketTypeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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
