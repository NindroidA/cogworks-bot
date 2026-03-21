import { AuditLog } from '../../../typeorm/entities/AuditLog';
import { lazyRepo } from '../../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../../monitoring/enhancedLogger';

const auditLogRepo = lazyRepo(AuditLog);

export type AuditSource = 'dashboard' | 'command' | 'system';

export async function writeAuditLog(
  guildId: string,
  action: string,
  triggeredBy: string | undefined,
  details?: Record<string, unknown>,
  source: AuditSource = 'dashboard',
): Promise<void> {
  if (!triggeredBy) return;

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
  } catch {
    // Audit logging is best-effort — don't fail the action
  }
}
