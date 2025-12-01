import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TicketStatus } from '../../../utils/types';

@Entity({ name: 'tickets'})
@Index(['guildId', 'status'])
export class Ticket {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    guildId: string;

    @Column({ nullable: true })
    channelId: string;

    @Column({ nullable: true })
    messageId: string;

    @Column()
    createdBy: string;

    @Column({ nullable: true })
    type: string;

    @Column({ nullable: true })
    customTypeId: string;

    @Column({ default: false })
    isEmailTicket: boolean;

    @Column({ nullable: true })
    emailSender: string;

    @Column({ nullable: true })
    emailSenderName: string;

    @Column({ nullable: true })
    emailSubject: string;

    @Column({ default: 'created' })
    status: TicketStatus;
}