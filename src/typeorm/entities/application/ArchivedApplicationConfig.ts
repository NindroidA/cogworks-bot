import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_application_configs' })
export class ArchivedApplicationConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column({ default: '' })
  messageId: string;

  @Column({ default: '' })
  channelId: string;
}
