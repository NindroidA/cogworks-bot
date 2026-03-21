import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('xp_users')
@Index(['guildId'])
@Index(['guildId', 'xp'])
@Index(['guildId', 'userId'], { unique: true })
export class XPUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  userId: string;

  @Column({ default: 0 })
  xp: number;

  @Column({ default: 0 })
  level: number;

  @Column({ default: 0 })
  messages: number;

  @Column({ default: 0 })
  voiceMinutes: number;

  @Column({ type: 'datetime', nullable: true })
  lastXpAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastVoiceJoinedAt: Date | null;
}
