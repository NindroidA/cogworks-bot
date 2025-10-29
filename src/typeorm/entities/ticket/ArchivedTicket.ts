import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_tickets'})
@Index(['guildId'])
export class ArchivedTicket {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    guildId: string;

    @Column({ nullable: true })
    messageId: string;

    @Column()
    createdBy: string;

}