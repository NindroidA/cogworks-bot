import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'announcement_templates' })
@Unique(['guildId', 'name'])
export class AnnouncementTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column({ length: 50 })
  name: string;

  @Column({ length: 100 })
  displayName: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  description: string | null;

  @Column({ length: 7, default: '#5865F2' })
  color: string;

  @Column({ length: 256 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'simple-json', nullable: true })
  fields: Array<{ name: string; value: string; inline: boolean }> | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  footerText: string | null;

  @Column({ default: true })
  showTimestamp: boolean;

  @Column({ default: false })
  mentionRole: boolean;

  @Column({ default: false })
  isDefault: boolean;

  @Column({ type: 'varchar', nullable: true })
  createdBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
