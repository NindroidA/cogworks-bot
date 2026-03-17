import { AppDataSource } from '../../../typeorm';
import { AuditLog } from '../../../typeorm/entities/AuditLog';
import { enhancedLogger, LogCategory } from '../../monitoring/enhancedLogger';

const auditLogRepo = AppDataSource.getRepository(AuditLog);

export async function writeAuditLog(
  guildId: string,
  action: string,
  triggeredBy: string | undefined,
  details?: Record<string, unknown>,
): Promise<void> {
  if (!triggeredBy) return;

  try {
    await auditLogRepo.save(
      auditLogRepo.create({
        guildId,
        action,
        triggeredBy,
        source: 'dashboard',
        details: details || null,
      }),
    );
    enhancedLogger.info(`${action} by <@${triggeredBy}> via dashboard`, LogCategory.API, {
      guildId,
      triggeredBy,
    });
  } catch {
    // Audit logging is best-effort — don't fail the action
  }
}
