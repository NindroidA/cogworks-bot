import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: 'server_configs' })
export class ServerConfig {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    guildId: string;

    @Column({ nullable: true })
    modRole: string;

    @Column({ nullable: true })
    adminRole: string;
}