import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DmFailureReason = 'closed' | 'no_shared_guild' | 'timeout' | 'unknown';

@Entity('bait_channel_logs')
@Index(['guildId', 'createdAt'])
export class BaitChannelLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  userId: string;

  @Column()
  username: string;

  @Column()
  channelId: string;

  @Column('text')
  messageContent: string;

  @Column()
  messageId: string;

  // 'banned', 'kicked', 'timed-out', 'softban', 'whitelisted', 'deleted-in-time',
  // 'failed', 'ban-after-leave', 'demoted-after-leave', 'superseded-by-mod',
  // 'raid-mode-entered', 'raid-mode-released', 'test-*'
  @Column()
  actionTaken: string;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  // Smart detection data
  @Column({ type: 'float' })
  accountAgeDays: number;

  @Column({ type: 'float' })
  membershipMinutes: number;

  @Column({ default: 0 })
  messageCount: number;

  @Column({ default: false })
  hasVerifiedRole: boolean;

  @Column({ default: 0 })
  suspicionScore: number; // 0-100

  @Column('simple-json', { nullable: true })
  detectionFlags: {
    newAccount: boolean;
    newMember: boolean;
    noMessages: boolean;
    noVerification: boolean;
    suspiciousContent: boolean;
    linkSpam: boolean;
    mentionSpam: boolean;
    defaultAvatar: boolean;
    emptyProfile: boolean;
    suspiciousUsername: boolean;
    noRoles: boolean;
    discordInvite: boolean;
    phishingUrl: boolean;
    attachmentOnly: boolean;
    joinBurst: boolean;
    crossChannelBurst?: boolean;
  } | null;

  // Override tracking (Plan 06 / v3.0.0)
  @Column({ default: false })
  overridden: boolean;

  @Column({ type: 'varchar', nullable: true })
  overriddenBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  overriddenAt: Date | null;

  // Audit-log correlation (v3.2.0)
  @Column({ type: 'varchar', nullable: true })
  discordAuditLogId: string | null;

  @Column({ type: 'varchar', nullable: true })
  executorId: string | null;

  @Column({ type: 'datetime', nullable: true })
  actionConfirmedAt: Date | null;

  // Unban tracking (v3.2.0)
  @Column({ type: 'datetime', nullable: true })
  unbannedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  unbannedBy: string | null;

  // DM observability (v3.2.0)
  @Column({ default: false })
  dmSent: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  dmFailureReason: DmFailureReason | null;

  // Log channel delivery (v3.2.0)
  @Column({ default: false })
  logDeliveryFailed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
