import { LessThan } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { AuditLog } from '../../typeorm/entities/AuditLog';
import { AnnouncementLog } from '../../typeorm/entities/announcement/AnnouncementLog';
import { BaitChannelLog } from '../../typeorm/entities/BaitChannelLog';
import { JoinEvent } from '../../typeorm/entities/bait/JoinEvent';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

// Retention periods
const BAIT_LOG_RETENTION_DAYS = 90;
const ANNOUNCEMENT_LOG_RETENTION_DAYS = 365;
const AUDIT_LOG_RETENTION_DAYS = 90;
const JOIN_EVENT_RETENTION_DAYS = 7;

// Run cleanup once per day (24 hours)
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Delete log records older than their retention period.
 */
async function runLogCleanup(): Promise<void> {
  const baitCutoff = new Date(Date.now() - BAIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const announcementCutoff = new Date(
    Date.now() - ANNOUNCEMENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  try {
    const baitRepo = AppDataSource.getRepository(BaitChannelLog);
    const baitResult = await baitRepo.delete({
      createdAt: LessThan(baitCutoff),
    });

    if (baitResult.affected && baitResult.affected > 0) {
      enhancedLogger.info(
        `Log cleanup: removed ${baitResult.affected} bait channel logs older than ${BAIT_LOG_RETENTION_DAYS} days`,
        LogCategory.DATABASE,
      );
    }
  } catch (error) {
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.LOW,
      message: 'Failed to clean up bait channel logs',
      error,
      context: { cutoff: baitCutoff.toISOString() },
    });
  }

  try {
    const announcementRepo = AppDataSource.getRepository(AnnouncementLog);
    const announcementResult = await announcementRepo.delete({
      sentAt: LessThan(announcementCutoff),
    });

    if (announcementResult.affected && announcementResult.affected > 0) {
      enhancedLogger.info(
        `Log cleanup: removed ${announcementResult.affected} announcement logs older than ${ANNOUNCEMENT_LOG_RETENTION_DAYS} days`,
        LogCategory.DATABASE,
      );
    }
  } catch (error) {
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.LOW,
      message: 'Failed to clean up announcement logs',
      error,
      context: { cutoff: announcementCutoff.toISOString() },
    });
  }

  try {
    const auditCutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const auditRepo = AppDataSource.getRepository(AuditLog);
    const auditResult = await auditRepo.delete({
      createdAt: LessThan(auditCutoff),
    });

    if (auditResult.affected && auditResult.affected > 0) {
      enhancedLogger.info(
        `Log cleanup: removed ${auditResult.affected} audit logs older than ${AUDIT_LOG_RETENTION_DAYS} days`,
        LogCategory.DATABASE,
      );
    }
  } catch (error) {
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.LOW,
      message: 'Failed to clean up audit logs',
      error,
      context: {},
    });
  }

  try {
    const joinEventCutoff = new Date(Date.now() - JOIN_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const joinEventRepo = AppDataSource.getRepository(JoinEvent);
    const joinEventResult = await joinEventRepo.delete({
      joinedAt: LessThan(joinEventCutoff),
    });

    if (joinEventResult.affected && joinEventResult.affected > 0) {
      enhancedLogger.info(
        `Log cleanup: removed ${joinEventResult.affected} join events older than ${JOIN_EVENT_RETENTION_DAYS} days`,
        LogCategory.DATABASE,
      );
    }
  } catch (error) {
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.LOW,
      message: 'Failed to clean up join events',
      error,
      context: {},
    });
  }
}

/**
 * Start the daily log cleanup interval.
 * Runs immediately on first call, then every 24 hours.
 */
export function startLogCleanup(): void {
  if (cleanupInterval) return;

  // Run once immediately (non-blocking)
  runLogCleanup().catch(error => {
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.LOW,
      message: 'Initial log cleanup failed',
      error,
      context: {},
    });
  });

  cleanupInterval = setInterval(() => {
    runLogCleanup().catch(error => {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.LOW,
        message: 'Scheduled log cleanup failed',
        error,
        context: {},
      });
    });
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the log cleanup interval (call on shutdown).
 */
export function stopLogCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
