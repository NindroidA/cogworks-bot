import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export interface ApplicationWorkflowStatus {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

@Entity({ name: 'application_configs' })
export class ApplicationConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column()
  messageId: string;

  @Column()
  channelId: string;

  @Column({ type: 'varchar', nullable: true })
  categoryId: string | null;

  // Workflow configuration
  @Column({ default: false })
  enableWorkflow: boolean;

  @Column({ type: 'simple-json', nullable: true })
  workflowStatuses: ApplicationWorkflowStatus[] | null;
}
