import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ReactionRoleOption } from './ReactionRoleOption';

/**
 * Behaviour mode for a reaction-role menu.
 * - `normal`: users can opt into multiple roles freely
 * - `unique`: picking a new role removes the previous one (single-select)
 * - `lock`: roles are sticky — adding works, removing does not
 */
export type ReactionRoleMode = 'normal' | 'unique' | 'lock';

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
  mode: ReactionRoleMode;

  // `require()` is intentional — a plain static `import { ReactionRoleOption }`
  // breaks TypeORM metadata loading because ReactionRoleOption has a
  // `@ManyToOne(() => ReactionRoleMenu)` back-reference. Attempted a static
  // import in v3.1.6 and 30 unit tests began failing with "Unable to resolve
  // target entity" at Entity registration time. The `require()` defers the
  // lookup to after both entity modules have been loaded.
  @OneToMany(
    () => require('./ReactionRoleOption').ReactionRoleOption,
    (option: ReactionRoleOption) => option.menu,
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
