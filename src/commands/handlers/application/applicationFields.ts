import type { ChatInputCommandInteraction } from 'discord.js';
import { Position } from '../../../typeorm/entities/application/Position';
import { guardFeatureAccess, handleInteractionError, lang, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { createFieldHandlers, type FieldManagerConfig } from '../shared/fieldManagerCore';

const pl = lang.application.position;
const fl = lang.application.position.fields;

// Track active field management sessions (userId_guildId -> timestamp)
// A value of SESSION_COMPLETED means the session was completed via Done
const fieldSessionMap = new Map<string, number>();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_COMPLETED = -1;

function getSessionKey(userId: string, guildId: string, positionId?: string): string {
  return positionId ? `${userId}_${guildId}_${positionId}` : `${userId}_${guildId}`;
}

type SessionStatus = 'active' | 'expired' | 'completed' | 'none';

function checkSession(userId: string, guildId: string, entityId?: string): SessionStatus {
  const key = getSessionKey(userId, guildId, entityId);
  const sessionStart = fieldSessionMap.get(key);
  if (sessionStart === undefined) return 'none';
  if (sessionStart === SESSION_COMPLETED) return 'completed';
  if (Date.now() - sessionStart >= SESSION_TIMEOUT_MS) return 'expired';
  return 'active';
}

function completeSession(userId: string, guildId: string, entityId?: string): void {
  fieldSessionMap.set(getSessionKey(userId, guildId, entityId), SESSION_COMPLETED);
}

// Clean up expired/completed sessions every minute. Deferred to an
// explicit start() call (wired from the bot's clientReady handler) so
// importing this module does not kick off background timers during tests
// or tooling runs.
let fieldSessionCleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startFieldSessionCleanup(): void {
  if (fieldSessionCleanupInterval) return;
  fieldSessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of fieldSessionMap.entries()) {
      if (timestamp === SESSION_COMPLETED || (timestamp > 0 && now - timestamp >= SESSION_TIMEOUT_MS)) {
        fieldSessionMap.delete(key);
      }
    }
  }, 60 * 1000);
}

/** Stop the field session cleanup interval (call on shutdown) */
export function stopFieldSessionCleanup(): void {
  if (fieldSessionCleanupInterval) {
    clearInterval(fieldSessionCleanupInterval);
    fieldSessionCleanupInterval = null;
  }
}

const positionRepo = lazyRepo(Position);

/** Config for application field manager */
const appFieldConfig: FieldManagerConfig<Position> = {
  prefix: 'appfield_',
  entityLabel: 'position',
  getDisplayTitle: pos => `🔧 ${fl.title}: ${pos.emoji || '📝'} ${pos.title}`,
  getEmbedColor: () => 0x5865f2,
  getFooterText: pos => `Position ID: ${pos.id}`,
  getEntityId: pos => String(pos.id),
  findEntity: async (guildId, entityId) => {
    const positionId = parseInt(entityId, 10);
    return positionRepo.findOne({ where: { id: positionId, guildId } });
  },
  saveEntity: async pos => {
    await positionRepo.save(pos);
  },
  messages: {
    notFound: pl.notFound,
    noFields: fl.noFields,
    fieldComplete: fl.complete,
    previewNote: fl.previewNote,
    invalidId: fl.invalidId,
    invalidStyle: fl.invalidStyle,
    duplicateId: fl.duplicateId,
    maxReached: fl.maxReached,
    fieldNotFound: fl.notFound,
  },
  session: {
    check: checkSession,
    complete: completeSession,
    expiredMessage: pl.sessionExpired,
    completedMessage: pl.sessionCompleted,
  },
};

const fields = createFieldHandlers(appFieldConfig);
export const handleAppAddFieldModal = fields.handleAddFieldModal;
export const handleAppFieldButton = fields.handleFieldButton;
export const handleAppFieldSelectMenu = fields.handleFieldSelectMenu;
export const handleAppPreviewModal = fields.handlePreviewModal;

/**
 * Handler for /application position fields command
 * Interactive UI for managing custom input fields
 */
export async function applicationFieldsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const positionValue = interaction.options.getString('position', true);
    const positionId = parseInt(positionValue, 10);

    const position = await positionRepo.findOne({
      where: { id: positionId, guildId },
    });

    if (!position) {
      await replyEphemeralError(interaction, pl.notFound);
      return;
    }

    // Start a new session for this user (keyed by positionId to allow concurrent editing)
    fieldSessionMap.set(getSessionKey(interaction.user.id, guildId, positionValue), Date.now());

    await fields.showFieldManager(interaction, position);
  } catch (error) {
    await handleInteractionError(interaction, error, 'applicationFieldsHandler');
  }
}
