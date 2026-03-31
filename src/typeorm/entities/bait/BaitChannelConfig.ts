import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type BaitActionType = 'ban' | 'kick' | 'timeout' | 'log-only';

@Entity('bait_channel_configs')
@Index(['guildId'])
export class BaitChannelConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column()
  channelId: string;

  @Column({ type: 'varchar', nullable: true })
  channelMessageId: string | null;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: 15 })
  gracePeriodSeconds: number;

  @Column('simple-array', { nullable: true })
  whitelistedRoles: string[] | null;

  @Column('simple-array', { nullable: true })
  whitelistedUsers: string[] | null;

  @Column({ type: 'varchar', nullable: true })
  logChannelId: string | null;

  @Column({ type: 'varchar', nullable: true })
  logChannelMessageId: string | null;

  @Column({ default: 'Posted in bait channel - Potential bot/scammer' })
  banReason: string;

  @Column({
    default: '⚠️ You have posted in a restricted channel. This channel is monitored for unauthorized access.',
  })
  warningMessage: string;

  // Smart detection settings
  @Column({ default: true })
  enableSmartDetection: boolean;

  @Column({ default: 90 })
  instantActionThreshold: number;

  @Column({ default: 7 })
  minAccountAgeDays: number;

  @Column({ default: 5 })
  minMembershipMinutes: number;

  @Column({ default: 0 })
  minMessageCount: number;

  @Column({ default: false })
  requireVerification: boolean;

  @Column({ default: false })
  disableAdminWhitelist: boolean;

  // Action settings
  @Column({ default: 'ban' }) // 'ban', 'kick', 'timeout', 'log-only'
  actionType: BaitActionType;

  @Column({ default: false })
  deleteUserMessages: boolean;

  @Column({ default: 24 })
  deleteMessageHours: number;

  // Timeout settings (Plan 03)
  @Column({ default: 60 })
  timeoutDurationMinutes: number; // 1-40320 (1 min to 28 days)

  // Escalation settings (Plan 03)
  @Column({ default: false })
  enableEscalation: boolean;

  @Column({ default: 30 })
  escalationLogThreshold: number; // Score >= this: log only

  @Column({ default: 50 })
  escalationTimeoutThreshold: number; // Score >= this: timeout

  @Column({ default: 75 })
  escalationKickThreshold: number; // Score >= this: kick

  @Column({ default: 90 })
  escalationBanThreshold: number; // Score >= this: ban

  // DM notification settings (Plan 03)
  @Column({ default: false })
  dmBeforeAction: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  appealInfo: string | null; // Optional appeal instructions shown in DM

  // Join velocity settings (Plan 04)
  @Column({ default: 10 })
  joinVelocityThreshold: number; // Joins within window to trigger burst

  @Column({ default: 5 })
  joinVelocityWindowMinutes: number; // Sliding window in minutes

  // Multi-channel support (Plan 07)
  @Column('simple-array', { nullable: true })
  channelIds: string[] | null; // Multiple bait channels (max 3)

  // Test mode (Plan 07)
  @Column({ default: false })
  testMode: boolean;

  // Weekly summary (Plan 08)
  @Column({ default: false })
  enableWeeklySummary: boolean;

  @Column({ type: 'varchar', nullable: true })
  summaryChannelId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
