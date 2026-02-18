import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ApplicationStatus } from '../../../utils/types';

@Entity({ name: 'applications' })
@Index(['guildId'])
export class Application {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ nullable: true })
  channelId: string;

  @Column({ nullable: true })
  messageId: string;

  @Column()
  createdBy: string;

  @Column({ nullable: true })
  type: string;

  @Column({ default: 'created' })
  status: ApplicationStatus;
}
