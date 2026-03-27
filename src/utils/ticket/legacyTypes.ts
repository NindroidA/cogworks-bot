/**
 * Legacy Ticket Types
 *
 * These are the original hardcoded ticket type IDs from before custom ticket
 * types were introduced. They use hardcoded modals instead of dynamic ones.
 * Used to determine whether to show legacy or custom modals in ticketInteraction.
 */

export const LEGACY_TICKET_TYPE_IDS = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'] as const;

export type LegacyTicketTypeId = (typeof LEGACY_TICKET_TYPE_IDS)[number];

/** Check if a ticket type ID is a legacy (hardcoded) type */
export function isLegacyTicketType(typeId: string): typeId is LegacyTicketTypeId {
  return LEGACY_TICKET_TYPE_IDS.includes(typeId as LegacyTicketTypeId);
}

/** Display names for legacy ticket types */
export const LEGACY_TYPE_NAMES: Record<LegacyTicketTypeId, string> = {
  '18_verify': '18+ Verify',
  ban_appeal: 'Ban Appeal',
  player_report: 'Player Report',
  bug_report: 'Bug Report',
  other: 'Other',
};

/** Full display info (name + emoji) for legacy ticket types — used by archive/forum tag logic */
export const LEGACY_TYPE_INFO: Record<LegacyTicketTypeId, { display: string; emoji: string }> = {
  '18_verify': { display: '18+ Verification', emoji: '🔞' },
  ban_appeal: { display: 'Ban Appeal', emoji: '⚖️' },
  player_report: { display: 'Player Report', emoji: '📢' },
  bug_report: { display: 'Bug Report', emoji: '🐛' },
  other: { display: 'Other', emoji: '❓' },
};
