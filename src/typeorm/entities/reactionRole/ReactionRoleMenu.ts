import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReactionRoleOption } from './ReactionRoleOption';

@Entity({ name: 'reaction_role_menus' })
@Index(['guildId'])
@Index(['guildId', 'messageId'])
export class ReactionRoleMenu {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  guildId: string;

  @Column({ type: 'varchar', length: 255 })
  channelId: string;

  @Column({ type: 'varchar', length: 255 })
  messageId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: 'normal' })
  mode: 'normal' | 'unique' | 'lock';

  @OneToMany(
    () => ReactionRoleOption,
    option => option.menu,
    {
      cascade: true,
      eager: true,
    },
  )
  options: ReactionRoleOption[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
