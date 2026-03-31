import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

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

  @Column()
  actionTaken: string; // 'banned', 'kicked', 'whitelisted', 'deleted-in-time', 'failed'

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
  } | null;

  // Override tracking (Plan 06)
  @Column({ default: false })
  overridden: boolean;

  @Column({ type: 'varchar', nullable: true })
  overriddenBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  overriddenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
