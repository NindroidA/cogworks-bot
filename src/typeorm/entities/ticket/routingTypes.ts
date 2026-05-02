/**
 * Routing column types for `TicketConfig`.
 *
 * Lives next to the entity rather than in `utils/ticket/smartRouter.ts`
 * so the entity (data shape) does not depend on the runtime helper that
 * consumes it. The smart router imports these from here.
 */

export interface RoutingRule {
  /** The custom ticket type ID (e.g., 'bug_report', 'ban_appeal') */
  ticketTypeId: string;
  /** Discord role ID for the staff group that handles this type */
  staffRoleId: string;
  /** Maximum open assigned tickets per staff member (optional cap) */
  maxOpen?: number;
}

export type RoutingStrategy = 'round-robin' | 'least-load' | 'random';
