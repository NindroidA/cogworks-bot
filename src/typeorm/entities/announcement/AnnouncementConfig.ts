import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class AnnouncementConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  guildId: string;

  // @deprecated — Use defaultRoleId instead. Kept for legacy migration.
  @Column()
  minecraftRoleId: string;

  @Column({ type: 'varchar', nullable: true })
  defaultRoleId: string | null;

  @Column()
  defaultChannelId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
