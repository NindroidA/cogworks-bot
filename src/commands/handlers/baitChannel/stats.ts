import { ChatInputCommandInteraction, Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { MoreThan } from 'typeorm';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelLog } from '../../../typeorm/entities/BaitChannelLog';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';

const tl = lang.baitChannel;

export const statsHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
	try {
		const days = interaction.options.getInteger('days') || 7;
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - days);

		const logRepo = AppDataSource.getRepository(BaitChannelLog);
		const logs = await safeDbOperation(
			() => logRepo.find({
				where: { 
					guildId: interaction.guildId!,
					createdAt: MoreThan(cutoff)
				},
				order: { createdAt: 'DESC' }
			}),
			'Fetch bait channel logs'
		);

		const recentLogs = logs || [];

		const stats = {
			total: recentLogs.length,
			banned: recentLogs.filter(l => l.actionTaken === 'banned').length,
			kicked: recentLogs.filter(l => l.actionTaken === 'kicked').length,
			deleted: recentLogs.filter(l => l.actionTaken === 'deleted-in-time').length,
			whitelisted: recentLogs.filter(l => l.actionTaken === 'whitelisted').length,
			avgScore: recentLogs.length > 0 
				? (recentLogs.reduce((sum, l) => sum + l.suspicionScore, 0) / recentLogs.length).toFixed(1)
				: '0'
		};

		const embed = new EmbedBuilder()
			.setColor('#0099FF')
			.setTitle(tl.stats.title)
			.setDescription(tl.stats.description.replace('{0}', days.toString()))
			.addFields(
				{ name: tl.stats.totalTriggers, value: `${stats.total}`, inline: true },
				{ name: tl.stats.banned, value: `${stats.banned}`, inline: true },
				{ name: tl.stats.kicked, value: `${stats.kicked}`, inline: true },
				{ name: tl.stats.deletedInTime, value: `${stats.deleted}`, inline: true },
				{ name: tl.stats.whitelisted, value: `${stats.whitelisted}`, inline: true },
				{ name: tl.stats.avgSuspicion, value: `${stats.avgScore}/100`, inline: true }
			)
			.setTimestamp();

		if (recentLogs.length > 0) {
			const topOffenders = recentLogs
				.slice(0, 5)
				.map((log, i) => `${i + 1}. ${log.username} (Score: ${log.suspicionScore})`)
				.join('\n');
			
			embed.addFields({
				name: tl.stats.recentDetections,
				value: topOffenders || tl.stats.none
			});
		}

		await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
	} catch (error) {
		await handleInteractionError(interaction, error, tl.error.fetchStats);
	}
};
