import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_applications' })
@Index(['guildId'])
@Index(['guildId', 'createdBy'])
export class ArchivedApplication {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ type: 'varchar', nullable: true })
  messageId: string | null;

  @Column()
  createdBy: string;

  /** Forum tags applied to the archive thread (position + Accepted/Rejected
   * outcome), accumulated across re-closes. Mirrors ArchivedTicket.forumTagIds. */
  @Column({ type: 'simple-json', nullable: true })
  forumTagIds: string[] | null;
}
