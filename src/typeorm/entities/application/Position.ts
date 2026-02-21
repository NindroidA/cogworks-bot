import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { CustomInputField } from '../shared/CustomInputField';

@Entity({ name: 'positions' })
@Index(['guildId', 'isActive'])
export class Position {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  title: string;

  @Column('text')
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  emoji: string | null;

  /**
   * Custom input fields for this position's application modal
   * Stored as JSON array of CustomInputField objects
   * If null/empty, shows a single default "Tell us about yourself" field
   */
  @Column({ type: 'json', nullable: true })
  customFields: CustomInputField[] | null;

  @Column({ default: false })
  ageGateEnabled: boolean;

  @Column({ default: false })
  isActive: boolean;

  @Column({ default: 0 })
  displayOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
