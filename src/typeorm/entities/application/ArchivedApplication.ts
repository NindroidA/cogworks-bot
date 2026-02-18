import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_applications' })
@Index(['guildId'])
export class ArchivedApplication {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ nullable: true })
  messageId: string;

  @Column()
  createdBy: string;
}
