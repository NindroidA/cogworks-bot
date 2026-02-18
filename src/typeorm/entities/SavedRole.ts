import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'staff_roles' })
@Index(['guildId'])
export class SavedRole {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guildId: string;

  @Column()
  type: string;

  @Column()
  role: string;

  @Column()
  alias: string;
}
