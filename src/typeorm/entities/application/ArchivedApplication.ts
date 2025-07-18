import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'archived_applications'})
export class ArchivedApplication {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    messageId: string;

    @Column()
    createdBy: string;

}