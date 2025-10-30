/**
 * Guild Create Event Handler
 * 
 * Handles the bot joining a new guild/server.
 * Sends a welcome message with setup instructions.
 */

import { Client, EmbedBuilder, Guild, REST, Routes, TextChannel } from 'discord.js';
import { commands } from '../commands/commandList';
import { logger } from '../utils';

const rest = new REST({ version: '10' }).setToken(process.env.RELEASE === 'dev' ? process.env.DEV_BOT_TOKEN! : process.env.BOT_TOKEN!);
const CLIENT_ID = process.env.RELEASE === 'dev' ? process.env.DEV_CLIENT_ID! : process.env.CLIENT_ID!;

export default {
	name: 'guildCreate',
	async execute(guild: Guild, client: Client) {
		try {
			logger(`Joined new guild: ${guild.name} (ID: ${guild.id}) - Members: ${guild.memberCount}`, 'INFO');

			// Register commands for this guild immediately
			try {
				await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), {
					body: commands,
				});
				logger(`✅ Registered commands for new guild: ${guild.id}`, 'INFO');
			} catch (error) {
				logger(`❌ Failed to register commands for guild ${guild.id}: ${(error as Error).message}`, 'ERROR');
			}

			// Find a suitable channel to send the welcome message
			const targetChannel = await findWelcomeChannel(guild);

			if (!targetChannel) {
				logger(`Could not find a suitable channel in guild ${guild.name} to send welcome message`, 'WARN');
				return;
			}

			// Create welcome embed
			const welcomeEmbed = new EmbedBuilder()
				.setColor('#5865F2') // Discord Blurple
				.setTitle('👋 Thanks for adding Cogworks Bot!')
				.setDescription(
					'**Cogworks Bot** is a comprehensive Discord management bot with ticketing, applications, announcements, and more!\n\n' +
					'To get started, use the `/bot-setup` command to configure the bot for your server.'
				)
				.addFields(
					{
						name: '🎫 Features',
						value: 
							'• **Ticketing System** - Organized support tickets with categories\n' +
							'• **Application System** - Job/role applications with custom positions\n' +
							'• **Announcements** - Beautiful announcement templates\n' +
							'• **Bait Channel** - Anti-bot/scammer protection\n' +
							'• **Role Management** - Easy role assignment commands',
						inline: false
					},
					{
						name: '🚀 Quick Start',
						value: 
							'1. Run `/bot-setup` to configure your server\n' +
							'2. Set up systems you need (tickets, applications, etc.)\n' +
							'3. Customize settings for each system\n' +
							'4. You\'re ready to go!',
						inline: false
					},
					{
						name: '📚 Commands',
						value: 
							'• `/bot-setup` - Complete bot configuration wizard\n' +
							'• `/ticket-setup` - Set up ticket system\n' +
							'• `/application-setup` - Set up application system\n' +
							'• `/announcement-setup` - Set up announcements\n' +
							'• `/baitchannel setup` - Set up anti-bot protection\n' +
							'• `/data-export` - Export your server data (GDPR)',
						inline: false
					},
					{
						name: '🔒 Privacy & Terms',
						value: 
							'• [Privacy Policy](https://github.com/yourusername/cogworks-bot/blob/main/docs/privacy_policy.md)\n' +
							'• [Terms of Service](https://github.com/yourusername/cogworks-bot/blob/main/docs/terms_of_service.md)\n' +
							'• We only store data necessary for bot functionality\n' +
							'• Data is deleted when the bot leaves your server',
						inline: false
					},
					{
						name: '❓ Need Help?',
						value: 
							'Join our [Support Server](https://discord.gg/cogworks) for:\n' +
							'• Setup assistance\n' +
							'• Feature requests\n' +
							'• Bug reports\n' +
							'• General questions',
						inline: false
					}
				)
				.setFooter({ 
					text: `Serving ${client.guilds.cache.size} servers`,
					iconURL: client.user?.displayAvatarURL()
				})
				.setTimestamp();

			// Send welcome message
			await targetChannel.send({ embeds: [welcomeEmbed] });
			logger(`Sent welcome message in ${guild.name} (#${targetChannel.name})`, 'INFO');

		} catch (error) {
			logger(`Error handling guild create for ${guild.name}: ${(error as Error).message}`, 'ERROR');
		}
	}
};

/**
 * Find the best channel to send the welcome message
 * Priority: system channel > general > first text channel
 * 
 * @param guild - Guild to find channel in
 * @returns Text channel or null
 */
async function findWelcomeChannel(guild: Guild): Promise<TextChannel | null> {
	// Try system channel first (where Discord sends join messages)
	if (guild.systemChannel && guild.systemChannel.isTextBased()) {
		return guild.systemChannel as TextChannel;
	}

	// Try to find a channel named "general"
	const generalChannel = guild.channels.cache.find(
		channel => 
			channel.isTextBased() && 
			(channel.name === 'general' || channel.name === 'chat')
	) as TextChannel | undefined;

	if (generalChannel) {
		return generalChannel;
	}

	// Find first text channel the bot can send messages in
	const firstTextChannel = guild.channels.cache.find(
		channel => {
			if (!channel.isTextBased()) return false;
			const textChannel = channel as TextChannel;
			const permissions = textChannel.permissionsFor(guild.members.me!);
			return permissions?.has(['SendMessages', 'EmbedLinks']);
		}
	) as TextChannel | undefined;

	return firstTextChannel || null;
}
