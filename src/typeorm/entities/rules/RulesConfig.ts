import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'rules_configs' })
// Note: guildId has unique constraint which creates an index automatically
export class RulesConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  guildId: string;

  @Column({ type: 'varchar', length: 255 })
  channelId: string;

  @Column({ type: 'varchar', length: 255 })
  messageId: string;

  @Column({ type: 'varchar', length: 255 })
  roleId: string;

  @Column({ type: 'varchar', length: 64, default: '✅' })
  emoji: string;

  @Column({ type: 'text', nullable: true })
  customMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
