import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'bot_configs' })
@Index(['guildId'])
export class BotConfig {

    @PrimaryColumn({ unique: true })
    guildId: string;

    @Column()
    enableGlobalStaffRole: boolean;

    @Column({ type: 'varchar', length: 255, nullable: true })
    globalStaffRole: string | null;
    
}