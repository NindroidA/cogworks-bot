import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'starboard_entries' })
@Index(['guildId'])
@Unique(['guildId', 'originalMessageId'])
export class StarboardEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  originalMessageId: string;

  @Column()
  originalChannelId: string;

  @Column()
  authorId: string;

  @Column()
  starboardMessageId: string;

  @Column()
  starCount: number;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'varchar', nullable: true })
  attachmentUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
