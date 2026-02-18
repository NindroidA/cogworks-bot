import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ReactionRoleMenu } from './ReactionRoleMenu';

@Entity({ name: 'reaction_role_options' })
@Index(['menuId'])
export class ReactionRoleOption {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(
    () => ReactionRoleMenu,
    menu => menu.options,
    { onDelete: 'CASCADE' },
  )
  menu: ReactionRoleMenu;

  @Column()
  menuId: number;

  @Column({ type: 'varchar', length: 64 })
  emoji: string;

  @Column({ type: 'varchar', length: 255 })
  roleId: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
