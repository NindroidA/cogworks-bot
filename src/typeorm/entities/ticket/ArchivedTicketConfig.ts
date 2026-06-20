import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_ticket_configs' })
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
