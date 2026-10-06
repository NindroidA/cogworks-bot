/**
 * Health check registry. Each feature module exports a list of checks and is
 * appended to `CHECKS`; ids must be unique (the registry test enforces it).
 */
import { APPLICATION_CHECKS } from './checks/applications';
import { CORE_CHECKS } from './checks/core';
import { MEMORY_CHECKS } from './checks/memory';
import { REACTION_ROLE_CHECKS } from './checks/reactionRoles';
import { RULES_CHECKS } from './checks/rules';
import { TICKET_CHECKS } from './checks/tickets';
import type { HealthCheck, HealthSystem } from './types';

const CHECKS: readonly HealthCheck[] = [
  ...CORE_CHECKS,
  ...TICKET_CHECKS,
  ...APPLICATION_CHECKS,
  ...MEMORY_CHECKS,
  ...RULES_CHECKS,
  ...REACTION_ROLE_CHECKS,
];

/** Every registered check, or only one system's, in report order. */
export function getChecks(system?: HealthSystem): readonly HealthCheck[] {
  return system ? CHECKS.filter(check => check.system === system) : CHECKS;
}
