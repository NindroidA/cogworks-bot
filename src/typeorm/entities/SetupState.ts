import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type SystemStatus = 'not_started' | 'partial' | 'complete';

export interface SystemStates {
  staffRole: SystemStatus;
  ticket: SystemStatus;
  application: SystemStatus;
  announcement: SystemStatus;
  baitchannel: SystemStatus;
  memory: SystemStatus;
  rules: SystemStatus;
  reactionRole: SystemStatus;
}

export interface PartialSystemData {
  staffRole?: { roleId?: string };
  ticket?: { channelId?: string; archiveId?: string; categoryId?: string };
  application?: { channelId?: string; archiveId?: string; categoryId?: string };
  announcement?: { roleId?: string; channelId?: string };
  baitchannel?: {
    channelId?: string;
    actionType?: string;
    logChannelId?: string;
    gracePeriod?: number;
  };
  memory?: { forumChannelId?: string };
  rules?: {
    channelId?: string;
    roleId?: string;
    emoji?: string;
    message?: string;
  };
}

export const DEFAULT_SYSTEM_STATES: SystemStates = {
  staffRole: 'not_started',
  ticket: 'not_started',
  application: 'not_started',
  announcement: 'not_started',
  baitchannel: 'not_started',
  memory: 'not_started',
  rules: 'not_started',
  reactionRole: 'not_started',
};

@Entity({ name: 'setup_states' })
@Index(['guildId'])
export class SetupState {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  /** Which systems the admin selected for setup */
  @Column({ type: 'json', nullable: true })
  selectedSystems: string[] | null;

  /** Per-system configuration status (MySQL JSON columns can't have defaults — set in code) */
  @Column({ type: 'json', nullable: true })
  systemStates: SystemStates;

  /** Saved partial data for incomplete system configurations */
  @Column({ type: 'json', nullable: true })
  partialData: PartialSystemData | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
