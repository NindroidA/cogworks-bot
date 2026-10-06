/**
 * Health-check engine types (v3.16.21).
 *
 * A `HealthReport` is plain JSON-serializable data so the same report can back
 * the `/bot-health` command and the internal API (both in later PRs).
 */
import type { SystemStates } from '../../typeorm/entities/SetupState';
import type { CheckContext, HealthEntityName } from './context';

/** block = feature broken; degraded = partly broken; cosmetic = hygiene. */
export type HealthSeverity = 'block' | 'degraded' | 'cosmetic';

/** auto = deterministic, no information loss; confirm = admin picks it in the preview; manual = the report explains. */
export type RepairClass = 'auto' | 'confirm' | 'manual';

/**
 * The `/bot-setup` system ids, `core` for BotConfig, staff roles, permissions and setup state,
 * and the features set up by their own commands (XP, starboard, onboarding).
 */
export type HealthSystem = 'core' | keyof SystemStates | 'xp' | 'starboard' | 'onboarding';

export type SystemHealthStatus = 'ok' | 'warn' | 'fail' | 'not_configured';

export interface HealthFinding {
  /** Stable dotted id (`<check id>.<problem>`), also the key into `lang.health.findings`. */
  code: string;
  system: HealthSystem;
  severity: HealthSeverity;
  repair: RepairClass;
  /** Entity class name the finding is about, e.g. `StaffRole`. */
  entity: string;
  rowId?: string | number;
  field?: string;
  /** Discord id the finding is about. */
  refId?: string;
  /** Values for the `{named}` placeholders in the finding's lang template. */
  params: Record<string, string | number>;
}

export interface HealthCheck {
  /** Stable id; every code the check emits starts with it. */
  id: string;
  system: HealthSystem;
  /** Guild-scoped entities the check reads. The runner loads each once and hands the check only these. */
  entities: readonly HealthEntityName[];
  /** Every finding code the check can emit (the lang test asserts each has a string). */
  codes: readonly string[];
  run(ctx: CheckContext): HealthFinding[] | Promise<HealthFinding[]>;
  /** `low`: its REST lookups only find cosmetic problems, so it runs after the other checks and the budget goes to them first. */
  restPriority?: 'low';
  /** False when the guild has not set this up. Omitted = always configured. */
  isConfigured?(ctx: CheckContext): boolean;
}

export interface CheckResult {
  checkId: string;
  system: HealthSystem;
  configured: boolean;
  findings: HealthFinding[];
}

export interface SystemReport {
  status: SystemHealthStatus;
  findings: HealthFinding[];
}

export interface HealthReport {
  guildId: string;
  botVersion: string;
  /** ISO timestamp. */
  checkedAt: string;
  deep: boolean;
  /** Only systems that have registered checks appear. */
  systems: Partial<Record<HealthSystem, SystemReport>>;
  counts: Record<RepairClass, number>;
  /** What could not be verified this run (REST budget spent, guild cache unavailable, ...). */
  notChecked: string[];
}
