import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Daily aggregate analytics snapshot — one row per guild per day.
 * Retention: 90 days (cleaned in logCleanup.ts alongside other retention jobs).
 */
@Entity({ name: 'analytics_snapshot' })
@Index(['guildId', 'date'], { unique: true })
export class AnalyticsSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ type: 'date' })
  date: Date;

  /** Total guild member count at end of day */
  @Column({ default: 0 })
  memberCount: number;

  /** Members who joined during this day */
  @Column({ default: 0 })
  memberJoined: number;

  /** Members who left during this day */
  @Column({ default: 0 })
  memberLeft: number;

  /** Total messages sent during this day */
  @Column({ default: 0 })
  messageCount: number;

  /** Unique message authors during this day */
  @Column({ default: 0 })
  activeMembers: number;

  /** Total voice channel minutes across all members */
  @Column({ default: 0 })
  voiceMinutes: number;

  /** Top 5 channels by message count: Array<{ channelId: string; name: string; count: number }> */
  @Column({ type: 'simple-json', nullable: true })
  topChannels: { channelId: string; name: string; count: number }[] | null;

  /** Hour with the most message activity (0-23 UTC) */
  @Column({ type: 'int', nullable: true })
  peakHourUtc: number | null;
}
