import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type StatusLevel =
  | 'operational'
  | 'degraded'
  | 'partial-outage'
  | 'major-outage'
  | 'maintenance';

@Entity({ name: 'bot_status' })
export class BotStatus {
  @PrimaryColumn()
  id: number; // Always 1 (singleton)

  @Column({ type: 'varchar', length: 20, default: 'operational' })
  level: StatusLevel;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'simple-json', nullable: true })
  affectedSystems: string[] | null;

  @Column({ type: 'datetime', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  estimatedResolution: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updatedBy: string | null;

  @Column({ default: false })
  isManualOverride: boolean;

  @Column({ type: 'datetime', nullable: true })
  manualOverrideExpiresAt: Date | null;
}
