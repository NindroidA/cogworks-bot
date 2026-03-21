import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'event_reminders' })
@Index(['guildId'])
@Index(['sent', 'reminderAt'])
export class EventReminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  discordEventId: string;

  @Column({ type: 'datetime' })
  reminderAt: Date;

  @Column({ default: false })
  sent: boolean;

  @Column({ type: 'varchar', nullable: true })
  eventTitle: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
