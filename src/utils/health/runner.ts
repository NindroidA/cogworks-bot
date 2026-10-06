/**
 * Health check runner. Read-only: it loads rows with `find` and reads Discord
 * caches, and never writes to the database or Discord. Repairs come later.
 */
import type { Guild } from 'discord.js';
import { version } from '../../../package.json';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { type CheckContext, createRestFetcher, type LoadedRows, loadRows, type RowLoader } from './context';
import { getChecks } from './registry';
import type { CheckResult, HealthCheck, HealthFinding, HealthReport, HealthSystem, SystemHealthStatus } from './types';

export interface HealthRunOptions {
  system?: HealthSystem;
  deep?: boolean;
}

/** Test seams; production uses the registry and the database loader. */
export interface HealthRunDeps {
  checks?: readonly HealthCheck[];
  loadRows?: RowLoader;
}

export async function runHealthCheck(
  guild: Guild,
  options: HealthRunOptions = {},
  deps: HealthRunDeps = {},
): Promise<HealthReport> {
  const checks = (deps.checks ?? getChecks()).filter(check => !options.system || check.system === options.system);
  const entities = checks.flatMap(check => check.entities);
  const ctx: CheckContext = {
    guildId: guild.id,
    guild,
    me: guild.members.me,
    deep: options.deep ?? false,
    rest: createRestFetcher(),
    rows: await loadRows(guild.id, entities, deps.loadRows),
  };

  // Checks whose REST lookups are only cosmetic run last, so block-level lookups get the shared budget first.
  // Results keep registry order, which is the report order.
  const results: CheckResult[] = [];
  for (const low of [false, true]) {
    const phase = checks.map(async (check, i) => {
      if ((check.restPriority === 'low') === low) results[i] = await runCheck(check, ctx);
    });
    await Promise.all(phase);
  }

  const notChecked: string[] = [];
  if (!guild.available) notChecked.push('guild-cache-unavailable');
  if (!ctx.me) notChecked.push('bot-member-unavailable');
  for (const label of ctx.rest.skipped) notChecked.push(`rest:${label}`);

  const meta = { guildId: guild.id, botVersion: version, checkedAt: new Date().toISOString(), deep: ctx.deep };
  return buildReport(results, { ...meta, notChecked });
}

/** Runs one check against only the entities it declared. A throw becomes a single `<id>.error` finding. */
export async function runCheck(check: HealthCheck, ctx: CheckContext): Promise<CheckResult> {
  const rows: LoadedRows = {};
  for (const entity of check.entities) rows[entity] = ctx.rows[entity];
  const scoped: CheckContext = { ...ctx, rows };
  try {
    const findings = await check.run(scoped);
    return { checkId: check.id, system: check.system, configured: check.isConfigured?.(scoped) ?? true, findings };
  } catch (error) {
    enhancedLogger.warn(`Health check ${check.id} failed`, LogCategory.SYSTEM, {
      guildId: ctx.guildId,
      error: error instanceof Error ? error.message : String(error),
    });
    const failed: HealthFinding = {
      code: `${check.id}.error`,
      system: check.system,
      severity: 'degraded',
      repair: 'manual',
      entity: check.entities[0] ?? 'none',
      params: {},
    };
    // Configured stays true: a database outage must never read as "not configured".
    return { checkId: check.id, system: check.system, configured: true, findings: [failed] };
  }
}

export function systemStatus(findings: readonly HealthFinding[], configured: boolean): SystemHealthStatus {
  if (findings.some(f => f.severity === 'block')) return 'fail';
  if (findings.length > 0) return 'warn';
  return configured ? 'ok' : 'not_configured';
}

export function buildReport(
  results: readonly CheckResult[],
  meta: Omit<HealthReport, 'systems' | 'counts'>,
): HealthReport {
  const report: HealthReport = { ...meta, systems: {}, counts: { auto: 0, confirm: 0, manual: 0 } };
  const bySystem = new Map<HealthSystem, CheckResult[]>();
  for (const result of results) bySystem.set(result.system, [...(bySystem.get(result.system) ?? []), result]);

  for (const [system, systemResults] of bySystem) {
    const findings = systemResults.flatMap(r => r.findings);
    for (const f of findings) report.counts[f.repair]++;
    const configured = systemResults.some(r => r.configured);
    report.systems[system] = { status: systemStatus(findings, configured), findings };
  }
  return report;
}
