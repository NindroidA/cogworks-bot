import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { RoutingStrategy } from '../../../utils/ticket/smartRouter';

export interface WorkflowStatus {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

@Entity({ name: 'ticket_configs' })
export class TicketConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: '' })
  messageId: string;

  @Column({ default: '' })
  channelId: string;

  @Column({ type: 'varchar', nullable: true })
  categoryId: string | null;

  @Column({ default: true })
  adminOnlyMentionStaff: boolean;

  // Legacy ticket type staff ping toggles
  @Column({ default: false })
  pingStaffOn18Verify: boolean;

  @Column({ default: false })
  pingStaffOnBanAppeal: boolean;

  @Column({ default: true })
  pingStaffOnPlayerReport: boolean;

  @Column({ default: false })
  pingStaffOnBugReport: boolean;

  @Column({ default: false })
  pingStaffOnOther: boolean;

  // Workflow configuration
  @Column({ default: false })
  enableWorkflow: boolean;

  @Column({ type: 'simple-json', nullable: true })
  workflowStatuses: WorkflowStatus[] | null;

  @Column({ default: false })
  autoCloseEnabled: boolean;

  @Column({ default: 7 })
  autoCloseDays: number;

  @Column({ default: 24 })
  autoCloseWarningHours: number;

  @Column({ default: 'resolved' })
  autoCloseStatus: string;

  // SLA configuration
  @Column({ default: false })
  slaEnabled: boolean;

  @Column({ default: 60 })
  slaTargetMinutes: number;

  @Column({ type: 'varchar', nullable: true })
  slaBreachChannelId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  slaPerType: Record<string, number> | null;

  // Smart routing configuration
  @Column({ default: false })
  smartRoutingEnabled: boolean;

  @Column({ type: 'simple-json', nullable: true })
  routingRules: Array<{
    ticketTypeId: string;
    staffRoleId: string;
    maxOpen?: number;
  }> | null;

  @Column({ type: 'varchar', default: 'least-load' })
  routingStrategy: RoutingStrategy;
}
