import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dedup key for moderation actions.
 *
 * Bait actions (banExecutor) key on the bait post: `action` holds
 * `<action>:<messageId>` (plus `:t` for a test-mode dry run), so the first
 * attempt, retries and the leave-drain share one row per post, and a later
 * post is a new event. Mod actions (auditLogEntryCreate) hold the bare
 * action; any key whose action was taken after a post was made covers it.
 * UNIQUE(guildId, userId, action, dayBucket) closes the race between two
 * callers on the same post. `expiresAt` drives TTL cleanup (24h).
 */
@Entity({ name: 'idempotency_keys' })
@Index(['guildId', 'userId', 'action', 'dayBucket'], { unique: true })
@Index(['expiresAt'])
export class IdempotencyKey {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  action: string;

  @Column({ type: 'date' })
  dayBucket: Date;

  @Column({ type: 'varchar', nullable: true })
  executorId: string | null;

  @Column({ default: false })
  testMode: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;
}
