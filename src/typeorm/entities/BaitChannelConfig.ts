import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('bait_channel_configs')
@Index(['guildId'])
export class BaitChannelConfig {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ unique: true })
	guildId: string;

	@Column()
	channelId: string;

	@Column({ nullable: true })
	channelMessageId: string;

	@Column({ default: true })
	enabled: boolean;

	@Column({ default: 15 })
	gracePeriodSeconds: number;

	@Column('simple-array', { nullable: true })
	whitelistedRoles: string[];

	@Column('simple-array', { nullable: true })
	whitelistedUsers: string[];

	@Column({ nullable: true })
	logChannelId: string;

	@Column({ nullable: true })
	logChannelMessageId: string;

	@Column({ default: 'Posted in bait channel - Potential bot/scammer' })
	banReason: string;

	@Column({ 
		default: '⚠️ You have posted in a restricted channel. This channel is monitored for unauthorized access.' 
	})
	warningMessage: string;

	// Smart detection settings
	@Column({ default: true })
	enableSmartDetection: boolean;

	@Column({ default: 7 })
	minAccountAgeDays: number;

	@Column({ default: 5 })
	minMembershipMinutes: number;

	@Column({ default: 0 })
	minMessageCount: number;

	@Column({ default: false })
	requireVerification: boolean;

	@Column({ default: false })
	disableAdminWhitelist: boolean;

	// Action settings
	@Column({ default: 'ban' }) // 'ban', 'kick', 'mute', 'log-only'
	actionType: string;

	@Column({ default: false })
	deleteUserMessages: boolean;

	@Column({ default: 7 })
	deleteMessageDays: number;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}
