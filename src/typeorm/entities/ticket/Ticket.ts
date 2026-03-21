import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { TicketStatus } from '../../../utils/types';

export interface TicketStatusHistoryEntry {
  status: string;
  changedBy: string;
  changedAt: string;
  note?: string;
}

@Entity({ name: 'tickets' })
@Index(['guildId', 'status'])
@Index(['guildId', 'createdBy'])
@Index(['guildId', 'channelId'])
export class Ticket {
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

  @Column({ type: 'varchar', nullable: true })
  customTypeId: string | null;

  @Column({ default: false })
  isEmailTicket: boolean;

  @Column({ type: 'varchar', nullable: true })
  emailSender: string | null;

  @Column({ type: 'varchar', nullable: true })
  emailSenderName: string | null;

  @Column({ type: 'varchar', nullable: true })
  emailSubject: string | null;

  @Column({ default: 'created' })
  status: TicketStatus;

  @Column({ type: 'varchar', nullable: true })
  assignedTo: string | null;

  @Column({ type: 'datetime', nullable: true })
  assignedAt: Date | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  lastActivityAt: Date;

  @Column({ type: 'simple-json', nullable: true })
  statusHistory: TicketStatusHistoryEntry[] | null;

  // SLA tracking
  @Column({ type: 'datetime', nullable: true })
  firstResponseAt: Date | null;

  @Column({ default: false })
  slaBreached: boolean;

  @Column({ default: false })
  slaBreachNotified: boolean;
}
