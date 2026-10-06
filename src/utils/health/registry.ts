/**
 * Health check registry. Each feature module exports a list of checks and is
 * appended to `CHECKS`; ids must be unique (the registry test enforces it).
 */
import { CORE_CHECKS } from './checks/core';
import type { HealthCheck, HealthSystem } from './types';

const CHECKS: readonly HealthCheck[] = [...CORE_CHECKS];

/** Every registered check, or only one system's, in report order. */
export function getChecks(system?: HealthSystem): readonly HealthCheck[] {
  return system ? CHECKS.filter(check => check.system === system) : CHECKS;
}
