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
}
