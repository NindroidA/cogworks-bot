import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_tickets'})
export class ArchivedTicket {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    messageId: string;

    @Column()
    createdBy: string;

}