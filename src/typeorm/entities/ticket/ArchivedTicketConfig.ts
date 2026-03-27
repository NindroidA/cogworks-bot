import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_ticket_configs' })
@Index(['guildId'])
export class ArchivedTicketConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: '' })
  messageId: string;

  @Column({ default: '' })
  channelId: string;
}
