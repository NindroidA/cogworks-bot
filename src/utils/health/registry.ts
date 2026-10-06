/**
 * Health check registry. Each feature module exports a list of checks and is
 * appended to `CHECKS`; ids must be unique (the registry test enforces it).
 */
import { ANNOUNCEMENT_CHECKS } from './checks/announcements';
import { APPLICATION_CHECKS } from './checks/applications';
import { COMMAND_CHECKS } from './checks/commands';
import { CORE_CHECKS } from './checks/core';
import { MEMORY_CHECKS } from './checks/memory';
import { ONBOARDING_CHECKS } from './checks/onboarding';
import { REACTION_ROLE_CHECKS } from './checks/reactionRoles';
import { RULES_CHECKS } from './checks/rules';
import { STARBOARD_CHECKS } from './checks/starboard';
import { TICKET_CHECKS } from './checks/tickets';
import { XP_CHECKS } from './checks/xp';
import type { HealthCheck, HealthSystem } from './types';

const CHECKS: readonly HealthCheck[] = [
  ...CORE_CHECKS,
  ...COMMAND_CHECKS,
  ...TICKET_CHECKS,
  ...APPLICATION_CHECKS,
  ...MEMORY_CHECKS,
  ...RULES_CHECKS,
  ...REACTION_ROLE_CHECKS,
  ...ANNOUNCEMENT_CHECKS,
  ...XP_CHECKS,
  ...STARBOARD_CHECKS,
  ...ONBOARDING_CHECKS,
];

/** Every registered check, or only one system's, in report order. */
export function getChecks(system?: HealthSystem): readonly HealthCheck[] {
  return system ? CHECKS.filter(check => check.system === system) : CHECKS;
}
