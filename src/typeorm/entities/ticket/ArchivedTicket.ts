import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_tickets' })
@Index(['guildId'])
@Index(['guildId', 'createdBy'])
export class ArchivedTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ type: 'varchar', nullable: true })
  messageId: string | null;

  @Column()
  createdBy: string;

  @Column({ type: 'varchar', nullable: true })
  ticketType: string | null;

  @Column({ type: 'varchar', nullable: true })
  customTypeId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  forumTagIds: string[] | null;

  @Column({ default: false })
  isEmailTicket: boolean;

  @Column({ type: 'varchar', nullable: true })
  emailSender: string | null;

  @Column({ type: 'varchar', nullable: true })
  emailSenderName: string | null;

  @Column({ type: 'varchar', nullable: true })
  emailSubject: string | null;
}
