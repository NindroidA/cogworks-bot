import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class AnnouncementLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    guildId: string;

    @Column()
    channelId: string;

    @Column()
    messageId: string;

    @Column()
    type: string; // 'maintenance_short', 'maintenance_long', 'update_scheduled', 'update_complete', 'back_online'

    @Column()
    sentBy: string;

    @Column({ type: 'datetime', nullable: true })
    scheduledTime: Date | null;

    @Column({ type: 'varchar', nullable: true })
    version: string | null;

    @CreateDateColumn()
    sentAt: Date;
}