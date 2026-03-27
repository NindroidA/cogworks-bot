import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'analytics_config' })
export class AnalyticsConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: false })
  enabled: boolean;

  /** Channel where weekly/monthly digest embeds are posted */
  @Column({ type: 'varchar', nullable: true })
  digestChannelId: string | null;

  /** 'weekly' | 'monthly' | 'both' */
  @Column({ type: 'varchar', default: 'weekly' })
  digestFrequency: string;

  /**
   * Day selector for digest scheduling.
   * For weekly: 0-6 (0 = Sunday).
   * For monthly: 1-28 (day of month).
   * Default 1 (Monday for weekly, 1st for monthly).
   */
  @Column({ default: 1 })
  digestDay: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
