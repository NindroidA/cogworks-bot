import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'memory_configs' })
// Note: guildId has unique constraint which creates an index automatically
export class MemoryConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  guildId: string;

  @Column({ type: 'varchar', length: 255 })
  forumChannelId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  messageId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
