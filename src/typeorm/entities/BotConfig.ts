import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'bot_configs' })
export class BotConfig {
  @PrimaryColumn()
  guildId: string;

  @Column({ default: false })
  enableGlobalStaffRole: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  globalStaffRole: string | null;

  // ISO-ish locale code resolved by src/lang. Unknown values fall back to 'en'
  // at read time, so it's safe to store legacy rows without this column.
  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale: string;
}
