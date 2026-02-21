import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { CustomInputField } from '../shared/CustomInputField';

export type { CustomInputField };

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

  /**
   * Whether to ping the global staff role when a ticket of this type is created
   * Defaults to false - admins must explicitly enable this per ticket type
   */
  @Column({ default: false })
  pingStaffOnCreate: boolean;
}
