/**
 * The systems `/bot-health` reports on, in display order: core first, then the
 * `/bot-setup` systems, then the features set up by their own commands. Staff
 * roles are left out because their checks are part of Core.
 */
import { DEFAULT_SYSTEM_STATES } from '../../typeorm/entities/SetupState';
import type { HealthSystem } from './types';

export const HEALTH_SYSTEMS: readonly HealthSystem[] = [
  'core',
  ...(Object.keys(DEFAULT_SYSTEM_STATES) as HealthSystem[]).filter(system => system !== 'staffRole'),
  'xp',
  'starboard',
  'onboarding',
];

/**
 * Systems with no checks yet. They aren't a `system` choice, and a check of all
 * systems lists them as not checked yet. A test fails once one gets checks, so
 * it moves to the choices together with them.
 */
export const HEALTH_SYSTEMS_NOT_CHECKED: readonly HealthSystem[] = ['baitchannel'];

/** The `system` choices besides `all`. A test requires each to have checks and a label. */
export const HEALTH_SYSTEM_CHOICES: readonly HealthSystem[] = HEALTH_SYSTEMS.filter(
  system => !HEALTH_SYSTEMS_NOT_CHECKED.includes(system),
);
