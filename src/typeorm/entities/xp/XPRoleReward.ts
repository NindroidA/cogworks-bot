import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('xp_role_rewards')
@Index(['guildId'])
@Index(['guildId', 'level'])
export class XPRoleReward {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  level: number;

  @Column()
  roleId: string;

  @Column({ default: false })
  removeOnDelevel: boolean;
}
