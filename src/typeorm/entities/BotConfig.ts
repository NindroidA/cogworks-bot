import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'bot_configs' })
export class BotConfig {
  @PrimaryColumn()
  guildId: string;

  @Column()
  enableGlobalStaffRole: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  globalStaffRole: string | null;
}
