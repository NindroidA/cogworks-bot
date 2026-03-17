import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('join_events')
@Index(['guildId'])
@Index(['guildId', 'joinedAt'])
export class JoinEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  userId: string;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  joinedAt: Date;

  @Column()
  accountCreatedAt: Date;

  @Column({ default: false })
  hasDefaultAvatar: boolean;

  @Column({ default: 1 })
  roleCount: number;

  @Column({ default: false })
  isSuspicious: boolean;

  @Column('text', { nullable: true })
  suspicionReasons: string;
}
