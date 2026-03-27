import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'starboard_config' })
@Index(['guildId'])
export class StarboardConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: false })
  enabled: boolean;

  @Column()
  channelId: string;

  @Column({ default: '\u2B50' })
  emoji: string;

  @Column({ default: 3 })
  threshold: number;

  @Column({ default: false })
  selfStar: boolean;

  @Column('simple-array', { nullable: true })
  ignoredChannels: string[] | null;

  @Column({ default: true })
  ignoreBots: boolean;

  @Column({ default: false })
  ignoreNSFW: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
