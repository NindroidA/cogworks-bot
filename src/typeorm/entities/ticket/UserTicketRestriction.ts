import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * User Ticket Type Restriction Entity
 *
 * Stores restrictions preventing specific users from creating specific ticket types.
 * Guild-scoped to maintain multi-server data isolation.
 */
@Entity('user_ticket_restrictions')
@Index(['guildId', 'userId'])
@Index(['guildId', 'typeId'])
@Index(['guildId', 'userId', 'typeId'], { unique: true })
export class UserTicketRestriction {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	guildId: string;

	@Column()
	userId: string;

	@Column()
	typeId: string;

	@Column({ nullable: true })
	restrictedBy: string;

	@Column({ type: 'text', nullable: true })
	reason: string | null;

	@CreateDateColumn()
	createdAt: Date;
}
