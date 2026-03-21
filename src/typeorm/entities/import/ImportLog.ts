import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'import_logs' })
@Index(['guildId', 'status'])
export class ImportLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  guildId: string;

  @Column()
  source: string;

  @Column()
  dataType: string;

  @Column({ default: 0 })
  importedCount: number;

  @Column({ default: 0 })
  skippedCount: number;

  @Column({ default: 0 })
  failedCount: number;

  @Column({ type: 'simple-json', nullable: true })
  errors: string[] | null;

  @Column()
  triggeredBy: string;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ default: 'running' })
  status: string;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;
}
