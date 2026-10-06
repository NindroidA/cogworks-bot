/**
 * Health check registry. Each feature module exports a list of checks and is
 * appended to `CHECKS`; ids must be unique (the registry test enforces it).
 */
import { ANNOUNCEMENT_CHECKS } from './checks/announcements';
import { CORE_CHECKS } from './checks/core';
import { ONBOARDING_CHECKS } from './checks/onboarding';
import { STARBOARD_CHECKS } from './checks/starboard';
import { XP_CHECKS } from './checks/xp';
import type { HealthCheck, HealthSystem } from './types';

const CHECKS: readonly HealthCheck[] = [
  ...CORE_CHECKS,
  ...ANNOUNCEMENT_CHECKS,
  ...XP_CHECKS,
  ...STARBOARD_CHECKS,
  ...ONBOARDING_CHECKS,
];

/** Every registered check, or only one system's, in report order. */
export function getChecks(system?: HealthSystem): readonly HealthCheck[] {
  return system ? CHECKS.filter(check => check.system === system) : CHECKS;
}
