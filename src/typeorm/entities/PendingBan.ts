import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'pending_bans' })
@Index(['guildId', 'expiresAt'])
export class PendingBan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  guildId: string;

  @Column()
  userId: string;

  @Column()
  messageId: string;

  @Column()
  channelId: string;

  @Column({ type: 'int', default: 0 })
  suspicionScore: number;

  @Column({ nullable: true })
  warningMessageId: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;
}
