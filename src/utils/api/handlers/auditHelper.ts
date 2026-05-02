import { AuditLog } from '../../../typeorm/entities/AuditLog';
import { lazyRepo } from '../../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../../monitoring/enhancedLogger';

const auditLogRepo = lazyRepo(AuditLog);

export type AuditSource = 'dashboard' | 'command' | 'system';

/**
 * Persist an audit-log entry for a mutating action.
 *
 * `triggeredBy` is logically required — every audit row is supposed to
 * answer "who did this?". The signature still accepts `undefined` for
 * backwards-compatibility with older call sites, but a missing value now
 * emits a loud warning so operators can tell the difference between
 * "audit row written" and "audit row silently skipped because the caller
 * forgot to pass triggeredBy". A future patch will tighten this to a
 * required parameter once every caller propagates it.
 */
export async function writeAuditLog(
  guildId: string,
  action: string,
  triggeredBy: string | undefined,
  details?: Record<string, unknown>,
  source: AuditSource = 'dashboard',
): Promise<void> {
  if (!triggeredBy) {
    enhancedLogger.warn(`Audit log skipped (no triggeredBy): ${action}`, LogCategory.API, {
      guildId,
      action,
      source,
    });
    return;
  }

  try {
    await auditLogRepo.save(
      auditLogRepo.create({
        guildId,
        action,
        triggeredBy,
        source,
        details: details || null,
      }),
    );
    enhancedLogger.info(`${action} by <@${triggeredBy}> via ${source}`, LogCategory.API, {
      guildId,
      triggeredBy,
    });
  } catch (error) {
    // Audit logging is best-effort — don't fail the action, but log the
    // failure so a persistent DB issue doesn't go unnoticed.
    enhancedLogger.error('Audit log write failed', error as Error, LogCategory.API, {
      guildId,
      action,
    });
  }
}
