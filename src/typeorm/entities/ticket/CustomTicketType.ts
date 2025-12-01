import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Input field configuration for custom ticket type modals
 * Allows admins to define custom questions for each ticket type
 */
export interface CustomInputField {
    id: string;                    // Unique identifier (e.g., 'player_name', 'incident_date')
    label: string;                 // Field label shown to user (e.g., 'Player Name')
    style: 'short' | 'paragraph';  // Short = single line, paragraph = multi-line
    placeholder?: string;          // Optional placeholder text
    required: boolean;             // Whether field is required
    minLength?: number;            // Minimum character length
    maxLength?: number;            // Maximum character length (max 4000 for paragraph, 100 for short)
}

@Entity({ name: 'custom_ticket_types' })
@Index(['guildId'])
@Index(['guildId', 'typeId'], { unique: true })
@Index(['guildId', 'isActive'])
export class CustomTicketType {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    guildId: string;

    @Column()
    typeId: string;

    @Column()
    displayName: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    emoji: string | null;

    @Column({ default: '#0099ff' })
    embedColor: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: false })
    isDefault: boolean;

    @Column({ default: 0 })
    sortOrder: number;

    /**
     * Custom input fields for this ticket type
     * Stored as JSON array of CustomInputField objects
     * If null/empty, shows default description field only
     */
    @Column({ type: 'json', nullable: true })
    customFields: CustomInputField[] | null;
}

