import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'application_configs' })
export class ApplicationConfig {

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
}