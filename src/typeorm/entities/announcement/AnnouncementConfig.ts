import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
@Index(['guildId'])
export class AnnouncementConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  // @deprecated — Use defaultRoleId instead. Kept for legacy migration.
  @Column({ default: '' })
  minecraftRoleId: string;

  @Column({ type: 'varchar', nullable: true })
  defaultRoleId: string | null;

  @Column({ default: '' })
  defaultChannelId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
