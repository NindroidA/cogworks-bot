/**
 * Builtin Ticket Types
 *
 * The 5 hardcoded ticket type IDs that ship with Cogworks. Builtin types
 * are NOT stored in the database — they are recognised by their typeId and
 * rendered via hardcoded Discord modal builders in `events/ticket/*.ts`.
 *
 * This module is the single source of truth for builtin display info, ping
 * column mapping, and the `resolveTicketType()` helper that unifies builtin
 * and custom-type lookups into a single shape. Downstream code should prefer
 * `resolveTicketType()` over bespoke branching.
 *
 * (Renamed from `legacyTypes` in v3.1.35 — these types are part of the
 * supported product surface, not a leftover from an older system.)
 */

import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import type { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { lazyRepo } from '../database/lazyRepo';

export const BUILTIN_TICKET_TYPE_IDS = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'] as const;

export type BuiltinTicketTypeId = (typeof BUILTIN_TICKET_TYPE_IDS)[number];

export interface BuiltinTypeDescriptor {
  typeId: BuiltinTicketTypeId;
  displayName: string;
  emoji: string;
}

/** Canonical display info for each builtin ticket type — single source of truth. */
export const BUILTIN_TYPES: readonly BuiltinTypeDescriptor[] = [
  { typeId: '18_verify', displayName: '18+ Verification', emoji: '🔞' },
  { typeId: 'ban_appeal', displayName: 'Ban Appeal', emoji: '⚖️' },
  { typeId: 'player_report', displayName: 'Player Report', emoji: '📢' },
  { typeId: 'bug_report', displayName: 'Bug Report', emoji: '🐛' },
  { typeId: 'other', displayName: 'Other', emoji: '❓' },
];

const BUILTIN_TYPE_BY_ID: Record<BuiltinTicketTypeId, BuiltinTypeDescriptor> = Object.fromEntries(
  BUILTIN_TYPES.map(t => [t.typeId, t]),
) as Record<BuiltinTicketTypeId, BuiltinTypeDescriptor>;

const BUILTIN_PING_COLUMNS: Record<BuiltinTicketTypeId, keyof TicketConfig> = {
  '18_verify': 'pingStaffOn18Verify',
  ban_appeal: 'pingStaffOnBanAppeal',
  player_report: 'pingStaffOnPlayerReport',
  bug_report: 'pingStaffOnBugReport',
  other: 'pingStaffOnOther',
};

/** Type guard: does this typeId match one of the hardcoded builtin types? */
export function isBuiltinTicketType(typeId: string): typeId is BuiltinTicketTypeId {
  return (BUILTIN_TICKET_TYPE_IDS as readonly string[]).includes(typeId);
}

/** Pure lookup for builtin display info. Returns null for non-builtin IDs. */
export function builtinTypeInfo(typeId: string): BuiltinTypeDescriptor | null {
  return isBuiltinTicketType(typeId) ? BUILTIN_TYPE_BY_ID[typeId] : null;
}

/** Map a builtin typeId to its `TicketConfig` ping-on-create column. */
export function resolveBuiltinPingColumn(typeId: string): keyof TicketConfig | null {
  return isBuiltinTicketType(typeId) ? BUILTIN_PING_COLUMNS[typeId] : null;
}

/**
 * Unified ticket type shape — lets callers treat builtin and custom types
 * identically for display purposes. `customType` is only populated for
 * custom-type resolutions and is null for builtin lookups. `isBuiltin`
 * preserves the distinction for the few callers (close workflow) that
 * branch on it.
 */
export interface ResolvedTicketType {
  typeId: string;
  displayName: string;
  emoji: string | null;
  isBuiltin: boolean;
  customType: CustomTicketType | null;
}

const customTypeRepo = lazyRepo(CustomTicketType);

/**
 * Resolve a typeId into a unified shape. Custom types take precedence: if a
 * `CustomTicketType` row exists for this guild+typeId it is returned, otherwise
 * the builtin descriptor is used. Returns null for unknown typeIds.
 */
export async function resolveTicketType(guildId: string, typeId: string): Promise<ResolvedTicketType | null> {
  const customType = await customTypeRepo.findOne({ where: { guildId, typeId } });
  if (customType) {
    return {
      typeId: customType.typeId,
      displayName: customType.displayName,
      emoji: customType.emoji,
      isBuiltin: false,
      customType,
    };
  }
  const builtin = builtinTypeInfo(typeId);
  if (builtin) {
    return {
      typeId: builtin.typeId,
      displayName: builtin.displayName,
      emoji: builtin.emoji,
      isBuiltin: true,
      customType: null,
    };
  }
  return null;
}
