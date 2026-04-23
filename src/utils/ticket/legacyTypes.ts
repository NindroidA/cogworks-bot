/**
 * Legacy Ticket Types
 *
 * The 5 hardcoded ticket type IDs that predate the `CustomTicketType` entity.
 * Legacy types are NOT stored in the database — they are recognised by their
 * typeId and rendered via hardcoded Discord modal builders in
 * `events/ticket/*.ts`.
 *
 * This module is the single source of truth for legacy display info, ping
 * column mapping, and the `resolveTicketType()` helper that unifies legacy
 * and custom-type lookups into a single shape. Downstream code should prefer
 * `resolveTicketType()` over bespoke branching.
 */

import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import type { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { lazyRepo } from '../database/lazyRepo';

export const LEGACY_TICKET_TYPE_IDS = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'] as const;

export type LegacyTicketTypeId = (typeof LEGACY_TICKET_TYPE_IDS)[number];

export interface LegacyTypeDescriptor {
  typeId: LegacyTicketTypeId;
  displayName: string;
  emoji: string;
}

/** Canonical display info for each legacy ticket type — single source of truth. */
export const LEGACY_TYPES: readonly LegacyTypeDescriptor[] = [
  { typeId: '18_verify', displayName: '18+ Verification', emoji: '🔞' },
  { typeId: 'ban_appeal', displayName: 'Ban Appeal', emoji: '⚖️' },
  { typeId: 'player_report', displayName: 'Player Report', emoji: '📢' },
  { typeId: 'bug_report', displayName: 'Bug Report', emoji: '🐛' },
  { typeId: 'other', displayName: 'Other', emoji: '❓' },
];

const LEGACY_TYPE_BY_ID: Record<LegacyTicketTypeId, LegacyTypeDescriptor> = Object.fromEntries(
  LEGACY_TYPES.map(t => [t.typeId, t]),
) as Record<LegacyTicketTypeId, LegacyTypeDescriptor>;

const LEGACY_PING_COLUMNS: Record<LegacyTicketTypeId, keyof TicketConfig> = {
  '18_verify': 'pingStaffOn18Verify',
  ban_appeal: 'pingStaffOnBanAppeal',
  player_report: 'pingStaffOnPlayerReport',
  bug_report: 'pingStaffOnBugReport',
  other: 'pingStaffOnOther',
};

/** Type guard: does this typeId match one of the hardcoded legacy types? */
export function isLegacyTicketType(typeId: string): typeId is LegacyTicketTypeId {
  return (LEGACY_TICKET_TYPE_IDS as readonly string[]).includes(typeId);
}

/** Pure lookup for legacy display info. Returns null for non-legacy IDs. */
export function legacyTypeInfo(typeId: string): LegacyTypeDescriptor | null {
  return isLegacyTicketType(typeId) ? LEGACY_TYPE_BY_ID[typeId] : null;
}

/** Map a legacy typeId to its `TicketConfig` ping-on-create column. */
export function resolveLegacyPingColumn(typeId: string): keyof TicketConfig | null {
  return isLegacyTicketType(typeId) ? LEGACY_PING_COLUMNS[typeId] : null;
}

/**
 * Unified ticket type shape — lets callers treat legacy and custom types
 * identically for display purposes. `customType` is only populated for
 * custom-type resolutions and is null for legacy lookups.
 */
export interface ResolvedTicketType {
  typeId: string;
  displayName: string;
  emoji: string | null;
  isLegacy: boolean;
  customType: CustomTicketType | null;
}

const customTypeRepo = lazyRepo(CustomTicketType);

/**
 * Resolve a typeId into a unified shape. Custom types take precedence: if a
 * `CustomTicketType` row exists for this guild+typeId it is returned, otherwise
 * the legacy descriptor is used. Returns null for unknown typeIds.
 */
export async function resolveTicketType(guildId: string, typeId: string): Promise<ResolvedTicketType | null> {
  const customType = await customTypeRepo.findOne({ where: { guildId, typeId } });
  if (customType) {
    return {
      typeId: customType.typeId,
      displayName: customType.displayName,
      emoji: customType.emoji,
      isLegacy: false,
      customType,
    };
  }
  const legacy = legacyTypeInfo(typeId);
  if (legacy) {
    return {
      typeId: legacy.typeId,
      displayName: legacy.displayName,
      emoji: legacy.emoji,
      isLegacy: true,
      customType: null,
    };
  }
  return null;
}
