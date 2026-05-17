import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PendingActionType = 'ban' | 'softban' | 'kick' | 'timeout' | 'log-only';

@Entity({ name: 'pending_actions' })
@Index(['guildId', 'expiresAt'])
@Index(['deadAt', 'expiresAt'])
export class PendingAction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  guildId: string;

  @Column()
  userId: string;

  @Column()
  messageId: string;

  @Column()
  channelId: string;

  @Column({ type: 'varchar', length: 32, default: 'ban' })
  action: PendingActionType;

  @Column({ type: 'int', default: 0 })
  suspicionScore: number;

  @Column({ type: 'varchar', nullable: true })
  warningMessageId: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'datetime', nullable: true })
  deadAt: Date | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;
}
