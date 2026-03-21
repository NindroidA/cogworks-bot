import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type IncidentLevel = 'degraded' | 'partial-outage' | 'major-outage' | 'maintenance';

@Entity({ name: 'status_incidents' })
@Index(['resolvedAt'])
export class StatusIncident {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  level: IncidentLevel;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolvedBy: string | null;

  @Column({ type: 'simple-json', nullable: true })
  affectedSystems: string[] | null;
}
