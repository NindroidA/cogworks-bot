import {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.baitChannel.builder;

export const baitChannelCommand = new SlashCommandBuilder()
	.setName('baitchannel')
	.setDescription(tl.cmdDescrp)
	.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
	.addSubcommand(subcommand =>
		subcommand
			.setName('setup')
			.setDescription(tl.setup.descrp)
			.addChannelOption(option =>
				option
					.setName('channel')
					.setDescription(tl.setup.channel)
					.addChannelTypes(ChannelType.GuildText)
					.setRequired(true)
			)
			.addIntegerOption(option =>
				option
					.setName('grace_period')
					.setDescription(tl.setup.gracePeriod)
					.setMinValue(0)
					.setMaxValue(60)
					.setRequired(true)
			)
			.addStringOption(option =>
				option
					.setName('action')
					.setDescription(tl.setup.action)
					.addChoices(
						{ name: tl.setup.actionBan, value: 'ban' },
						{ name: tl.setup.actionKick, value: 'kick' },
						{ name: tl.setup.actionLogOnly, value: 'log-only' }
					)
					.setRequired(true)
			)
			.addChannelOption(option =>
				option
					.setName('log_channel')
					.setDescription(tl.setup.logChannel)
					.addChannelTypes(ChannelType.GuildText)
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('detection')
			.setDescription(tl.detection.descrp)
			.addBooleanOption(option =>
				option
					.setName('enabled')
					.setDescription(tl.detection.enabled)
					.setRequired(true)
			)
			.addIntegerOption(option =>
				option
					.setName('min_account_age')
					.setDescription(tl.detection.minAccountAge)
					.setMinValue(0)
					.setMaxValue(365)
			)
			.addIntegerOption(option =>
				option
					.setName('min_membership')
					.setDescription(tl.detection.minMembership)
					.setMinValue(0)
					.setMaxValue(1440)
			)
			.addIntegerOption(option =>
				option
					.setName('min_messages')
					.setDescription(tl.detection.minMessages)
					.setMinValue(0)
					.setMaxValue(100)
			)
			.addBooleanOption(option =>
				option
					.setName('require_verification')
					.setDescription(tl.detection.requireVerification)
			)
			.addBooleanOption(option =>
				option
					.setName('disable_admin_whitelist')
					.setDescription(tl.detection.disableAdminWhitelist)
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('whitelist')
			.setDescription(tl.whitelist.descrp)
			.addStringOption(option =>
				option
					.setName('action')
					.setDescription(tl.whitelist.action)
					.addChoices(
						{ name: tl.whitelist.actionAdd, value: 'add' },
						{ name: tl.whitelist.actionRemove, value: 'remove' },
						{ name: tl.whitelist.actionList, value: 'list' }
					)
					.setRequired(true)
			)
			.addRoleOption(option =>
				option.setName('role').setDescription(tl.whitelist.role)
			)
			.addUserOption(option =>
				option.setName('user').setDescription(tl.whitelist.user)
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('status')
			.setDescription(tl.status.descrp)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('stats')
			.setDescription(tl.stats.descrp)
			.addIntegerOption(option =>
				option
					.setName('days')
					.setDescription(tl.stats.days)
					.setMinValue(1)
					.setMaxValue(90)
			)
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName('toggle')
			.setDescription(tl.toggle.descrp)
			.addBooleanOption(option =>
				option
					.setName('enabled')
					.setDescription(tl.toggle.enabled)
					.setRequired(true)
			)
	);
