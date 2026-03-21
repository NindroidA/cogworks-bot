import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { OnboardingStepDef } from '../../../utils/onboarding/types';

@Entity({ name: 'onboarding_configs' })
export class OnboardingConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 2000, default: 'Welcome to {server}!' })
  welcomeMessage: string;

  @Column({ type: 'simple-json', nullable: true })
  steps: OnboardingStepDef[] | null;

  @Column({ type: 'varchar', nullable: true })
  completionRoleId: string | null;

  @Column({ default: true })
  trackCompletionRate: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
