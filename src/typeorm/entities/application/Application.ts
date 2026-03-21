import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ApplicationStatus } from '../../../utils/types';

export interface ApplicationStatusHistoryEntry {
  status: string;
  changedBy: string;
  changedAt: string;
  note?: string;
}

export interface ApplicationInternalNote {
  note: string;
  addedBy: string;
  addedAt: string;
}

@Entity({ name: 'applications' })
@Index(['guildId'])
@Index(['guildId', 'createdBy'])
export class Application {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ type: 'varchar', nullable: true })
  channelId: string | null;

  @Column({ type: 'varchar', nullable: true })
  messageId: string | null;

  @Column()
  createdBy: string;

  @Column({ type: 'varchar', nullable: true })
  type: string | null;

  @Column({ default: 'created' })
  status: ApplicationStatus;

  // Workflow tracking
  @Column({ type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'simple-json', nullable: true })
  internalNotes: ApplicationInternalNote[] | null;

  @Column({ type: 'simple-json', nullable: true })
  statusHistory: ApplicationStatusHistoryEntry[] | null;
}
