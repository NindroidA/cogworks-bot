import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type MemoryTagType = 'category' | 'status';

@Entity({ name: 'memory_tags' })
@Index(['guildId'])
@Index(['guildId', 'tagType'])
export class MemoryTag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  guildId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  discordTagId: string | null;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  emoji: string | null;

  @Column({ type: 'varchar', length: 20 })
  tagType: MemoryTagType;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
