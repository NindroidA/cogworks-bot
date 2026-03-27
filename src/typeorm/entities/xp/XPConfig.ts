import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('xp_configs')
export class XPConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ default: 15 })
  xpPerMessageMin: number;

  @Column({ default: 25 })
  xpPerMessageMax: number;

  @Column({ default: 60 })
  xpCooldownSeconds: number;

  @Column({ default: 5 })
  xpPerVoiceMinute: number;

  @Column({ default: true })
  voiceXpEnabled: boolean;

  @Column({ type: 'varchar', nullable: true })
  levelUpChannelId: string | null;

  @Column({ default: 'Congrats {user}, you reached **Level {level}**!' })
  levelUpMessage: string;

  @Column('simple-array', { nullable: true })
  ignoredChannels: string[] | null;

  @Column('simple-array', { nullable: true })
  ignoredRoles: string[] | null;

  /** Channel ID -> multiplier (e.g., { "123456": 2 }) */
  @Column('simple-json', { nullable: true })
  multiplierChannels: Record<string, number> | null;

  @Column({ default: false })
  stackMultipliers: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
