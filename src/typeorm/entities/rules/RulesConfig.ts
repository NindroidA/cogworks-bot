import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'rules_configs' })
@Index(['guildId'])
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
