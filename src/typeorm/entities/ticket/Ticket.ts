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

    @Column({ default: 'created' })
    status: TicketStatus;
}