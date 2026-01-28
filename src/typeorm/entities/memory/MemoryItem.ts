import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'memory_items' })
@Index(['guildId'])
@Index(['guildId', 'status'])
export class MemoryItem {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255 })
    guildId: string;

    @Column({ type: 'varchar', length: 255 })
    threadId: string;

    @Column({ type: 'varchar', length: 255 })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'varchar', length: 50, default: 'Open' })
    status: string;

    @Column({ type: 'varchar', length: 255 })
    createdBy: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    sourceMessageId: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    sourceChannelId: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
