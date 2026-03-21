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

  @Column({ type: 'varchar', nullable: true })
  warningMessageId: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;
}
