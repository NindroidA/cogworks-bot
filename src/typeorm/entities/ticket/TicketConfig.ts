import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'ticket_configs' })
@Index(['guildId'])
export class TicketConfig {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    guildId: string;

    @Column()
    messageId: string;

    @Column()
    channelId: string;

    @Column({ nullable: true })
    categoryId: string;

    @Column({ default: true })
    adminOnlyMentionStaff: boolean;

    // Legacy ticket type staff ping toggles
    @Column({ default: false })
    pingStaffOn18Verify: boolean;

    @Column({ default: false })
    pingStaffOnBanAppeal: boolean;

    @Column({ default: true })
    pingStaffOnPlayerReport: boolean;

    @Column({ default: false })
    pingStaffOnBugReport: boolean;

    @Column({ default: false })
    pingStaffOnOther: boolean;
}