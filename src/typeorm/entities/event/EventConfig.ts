import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'event_configs' })
@Index(['guildId'])
export class EventConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'varchar', nullable: true })
  reminderChannelId: string | null;

  @Column({ default: 30 })
  defaultReminderMinutes: number;

  @Column({ default: false })
  postEventSummary: boolean;

  @Column({ type: 'varchar', nullable: true })
  summaryChannelId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
