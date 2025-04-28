import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: 'bot_configs' })
export class BotConfig {

    @PrimaryColumn({ unique: true })
    guildId: string;

    @Column()
    enableGlobalStaffRole: boolean;

    @Column({ nullable: true })
    globalStaffRole: string;
    
}