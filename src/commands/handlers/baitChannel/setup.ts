import { ChatInputCommandInteraction, Client, EmbedBuilder, TextChannel } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import { handleInteractionError, lang, logger, safeDbOperation } from '../../../utils';
import { BaitChannelManager } from '../../../utils/baitChannelManager';

const tl = lang.baitChannel;

export const setupHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
	try {
		const channel = interaction.options.getChannel('channel', true);
		const gracePeriod = interaction.options.getInteger('grace_period', true);
		const action = interaction.options.getString('action', true);
		const logChannel = interaction.options.getChannel('log_channel');

		const configRepo = AppDataSource.getRepository(BaitChannelConfig);

		let config = await safeDbOperation(
			() => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
			'Find bait channel config'
		);

		if (!config) {
			config = configRepo.create({
				guildId: interaction.guildId!,
				channelId: channel.id,
				gracePeriodSeconds: gracePeriod,
				actionType: action,
				logChannelId: logChannel?.id || undefined
			});
		} else {
			config.channelId = channel.id;
			config.gracePeriodSeconds = gracePeriod;
			config.actionType = action;
			if (logChannel) config.logChannelId = logChannel.id;
		}

		await safeDbOperation(
			() => configRepo.save(config!),
			'Save bait channel config'
		);

		// Send or update warning message in the BAIT CHANNEL (visible to everyone)
		if (channel instanceof TextChannel) {
			try {
				const warningContent = '# 🚨 **DO NOT POST HERE** 🚨\n\n' +
					'Not for fun. Not to "test" it. Not even as a joke.\n\n' +
					'This channel is monitored for bot detection.\n\n' +
					'If you post anything in here, our system will assume you are a bot and you **WILL BE BANNED**. No ifs, ands, or buts.\n\n' +
					'If you are a legitimate user, please do not post here. This is your only warning.';
				
				if (config.channelMessageId) {
					// Try to fetch and update existing message
					try {
						const existingMessage = await channel.messages.fetch(config.channelMessageId);
						await existingMessage.edit({ content: warningContent });
					} catch {
						// Message not found, send new one
						const msg = await channel.send({ content: warningContent });
						config.channelMessageId = msg.id;
						await configRepo.save(config);
					}
				} else {
					// First time setup - send new message and save ID
					const msg = await channel.send({ content: warningContent });
					config.channelMessageId = msg.id;
					await configRepo.save(config);
				}
			} catch {
				logger('Failed to send/update warning message to bait channel', 'WARN');
			}
		}

		// Clear cache
		const { baitChannelManager } = client as { baitChannelManager?: BaitChannelManager };
		if (baitChannelManager) {
			baitChannelManager.clearConfigCache(interaction.guildId!);
		}

		const embed = new EmbedBuilder()
			.setColor('#00FF00')
			.setTitle(tl.setup.title)
			.addFields(
				{ name: 'Channel', value: `<#${channel.id}>`, inline: true },
				{ name: 'Grace Period', value: `${gracePeriod}s`, inline: true },
				{ name: 'Action', value: action, inline: true }
			);

		if (logChannel) {
			embed.addFields({ name: 'Log Channel', value: `✅ Set to <#${logChannel.id}>` });
		}

		embed.setFooter({ text: tl.setup.footer });

		// Reply to the user with confirmation (ephemeral - only they can see it)
		await interaction.reply({ 
			embeds: [embed], 
			ephemeral: true
		});
	} catch (error) {
		await handleInteractionError(interaction, error, tl.error.setup);
	}
};
