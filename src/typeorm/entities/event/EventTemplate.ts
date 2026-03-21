import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type EventEntityType = 'voice' | 'stage' | 'external';
export type RecurringPattern = 'daily' | 'weekly' | 'biweekly' | 'monthly';

@Entity({ name: 'event_templates' })
@Unique(['guildId', 'name'])
@Index(['guildId'])
export class EventTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ length: 50 })
  name: string;

  @Column({ length: 100 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  location: string | null;

  @Column({ length: 20, default: 'external' })
  entityType: EventEntityType;

  @Column({ default: 60 })
  defaultDurationMinutes: number;

  @Column({ default: false })
  isRecurring: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  recurringPattern: RecurringPattern | null;

  @Column({ type: 'varchar', nullable: true })
  createdBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
