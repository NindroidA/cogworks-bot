import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_activity')
@Index(['guildId', 'userId'])
export class UserActivity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  userId: string;

  @Column({ default: 0 })
  messageCount: number;

  @Column({ type: 'timestamp', nullable: true })
  firstMessageAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  joinedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
