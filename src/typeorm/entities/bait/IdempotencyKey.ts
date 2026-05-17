import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dedup key for moderation actions.
 *
 * UNIQUE(guildId, userId, action, dayBucket) — a single row covers all
 * attempts to execute the same action against the same user on the same UTC
 * day. INSERT IGNORE: if the row already exists (someone — bot retry or
 * mod — already did this), skip.
 *
 * `dayBucket` is intentionally coarse (date, not timestamp). Cross-day
 * collisions are accepted as repeat-offender attempts, not duplicates.
 * `expiresAt` drives TTL cleanup (24h default; long enough to catch out-of-
 * order retries, short enough that the table stays small).
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
