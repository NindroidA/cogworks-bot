import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_application_configs' })
@Index(['guildId'])
export class ArchivedApplicationConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column()
  messageId: string;

  @Column()
  channelId: string;
}
