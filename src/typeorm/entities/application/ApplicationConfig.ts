import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'application_configs' })
@Index(['guildId'])
export class ApplicationConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  @Column()
  messageId: string;

  @Column()
  channelId: string;

  @Column({ nullable: true })
  categoryId: string;
}
