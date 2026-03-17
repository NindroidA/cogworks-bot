import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('bait_keywords')
@Index(['guildId'])
@Unique(['guildId', 'keyword'])
export class BaitKeyword {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ length: 100 })
  keyword: string;

  @Column({ default: 5 })
  weight: number; // 1-10 scoring weight

  @Column()
  createdBy: string; // Discord user ID or 'system'

  @CreateDateColumn()
  createdAt: Date;
}
