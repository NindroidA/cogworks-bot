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

    @Column({ nullable: true })
    ticketType: string;

    @Column({ nullable: true })
    customTypeId: string;

    @Column({ type: 'simple-json', nullable: true })
    forumTagIds: string[];

    @Column({ default: false })
    isEmailTicket: boolean;

    @Column({ nullable: true })
    emailSender: string;

    @Column({ nullable: true })
    emailSenderName: string;

    @Column({ nullable: true })
    emailSubject: string;

}