import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: 'staff_roles' })
export class SavedRole {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    guildId: string;

    @Column()
    type: string;

    @Column()
    role: string;

    @Column()
    alias: string;
}