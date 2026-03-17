import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'audit_logs' })
@Index(['guildId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  guildId: string;

  @Column()
  action: string;

  @Column()
  triggeredBy: string;

  @Column({ default: 'dashboard' })
  source: string;

  @Column({ type: 'json', nullable: true })
  details: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
