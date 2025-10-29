import {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

export const baitChannelCommand = new SlashCommandBuilder()
	.setName('baitchannel')
	.setDescription('Configure the bait channel anti-bot system')
	.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
	.addSubcommand(subcommand =>
		subcommand
			.setName('setup')
			.setDescription('Set up or update the bait channel configuration')
			.addChannelOption(option =>
				option
					.setName('channel')
					.setDescription('The bait channel')
					.addChannelTypes(ChannelType.GuildText)
					.setRequired(true)
			)
			.addIntegerOption(option =>
				option
					.setName('grace_period')
					.setDescription('Grace period in seconds (0 for instant action)')
					.setMinValue(0)
					.setMaxValue(60)
					.setRequired(true)
			)
			.addStringOption(option =>
				option
					.setName('action')
					.setDescription('Action to take')
					.addChoices(
						{ name: 'Ban', value: 'ban' },
						{ name: 'Kick', value: 'kick' },
						{ name: 'Log Only (Testing)', value: 'log-only' }
					)
					.setRequired(true)
			)
			.addChannelOption(option =>
				option
					.setName('log_channel')
					.setDescription('Channel for logging detections')
					.addChannelTypes(ChannelType.GuildText)
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('detection')
			.setDescription('Configure smart detection settings')
			.addBooleanOption(option =>
				option
					.setName('enabled')
					.setDescription('Enable smart detection')
					.setRequired(true)
			)
			.addIntegerOption(option =>
				option
					.setName('min_account_age')
					.setDescription('Minimum account age in days (default: 7)')
					.setMinValue(0)
					.setMaxValue(365)
			)
			.addIntegerOption(option =>
				option
					.setName('min_membership')
					.setDescription('Minimum server membership in minutes (default: 5)')
					.setMinValue(0)
					.setMaxValue(1440)
			)
			.addIntegerOption(option =>
				option
					.setName('min_messages')
					.setDescription('Minimum message count (default: 0)')
					.setMinValue(0)
					.setMaxValue(100)
			)
			.addBooleanOption(option =>
				option
					.setName('require_verification')
					.setDescription('Require verification role')
			)
			.addBooleanOption(option =>
				option
					.setName('disable_admin_whitelist')
					.setDescription('Disable automatic admin whitelist (for testing)')
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('whitelist')
			.setDescription('Manage whitelist')
			.addStringOption(option =>
				option
					.setName('action')
					.setDescription('Add, remove, or list whitelist')
					.addChoices(
						{ name: 'Add', value: 'add' },
						{ name: 'Remove', value: 'remove' },
						{ name: 'List', value: 'list' }
					)
					.setRequired(true)
			)
			.addRoleOption(option =>
				option.setName('role').setDescription('Role to whitelist')
			)
			.addUserOption(option =>
				option.setName('user').setDescription('User to whitelist')
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('status')
			.setDescription('View current configuration and statistics')
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('stats')
			.setDescription('View detailed statistics')
			.addIntegerOption(option =>
				option
					.setName('days')
					.setDescription('Number of days to analyze (default: 7)')
					.setMinValue(1)
					.setMaxValue(90)
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('toggle')
			.setDescription('Enable or disable the bait channel')
			.addBooleanOption(option =>
				option
					.setName('enabled')
					.setDescription('Enable or disable')
					.setRequired(true)
			)
	);
