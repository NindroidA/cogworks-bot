import { ChatInputCommandInteraction, Client, MessageFlags } from 'discord.js';
import { createRateLimitKey, handleInteractionError, lang, LANGF, logger, rateLimiter, RateLimits, requireAdmin } from '../../../utils';
import { detectionHandler } from './detection';
import { setupHandler } from './setup';
import { statsHandler } from './stats';
import { statusHandler } from './status';
import { toggleHandler } from './toggle';
import { whitelistHandler } from './whitelist';

export const baitChannelHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
	try {
		// Require admin permissions for all baitchannel subcommands
		const adminCheck = requireAdmin(interaction);
		if (!adminCheck.allowed) {
			await interaction.reply({
				content: adminCheck.message,
				flags: [MessageFlags.Ephemeral]
			});
			return;
		}

		const guildId = interaction.guildId || '';
		const subcommand = interaction.options.getSubcommand();
		
		// Rate limit check (guild-scoped: 10 bait channel operations per hour)
		const rateLimitKey = createRateLimitKey.guild(guildId, 'baitchannel');
		const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BAIT_CHANNEL);
		
		if (!rateCheck.allowed) {
			await interaction.reply({
				content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
				flags: [MessageFlags.Ephemeral]
			});
			logger(`Rate limit exceeded for bait channel command in guild ${guildId}`, 'WARN');
			return;
		}

		switch (subcommand) {
			case 'setup':
				await setupHandler(client, interaction);
				break;

			case 'detection':
				await detectionHandler(client, interaction);
				break;

			case 'whitelist':
				await whitelistHandler(client, interaction);
				break;

			case 'status':
				await statusHandler(client, interaction);
				break;

			case 'stats':
				await statsHandler(client, interaction);
				break;

			case 'toggle':
				await toggleHandler(client, interaction);
				break;

			default:
				await interaction.reply({
					content: lang.errors.unknownSubcommand,
					flags: [MessageFlags.Ephemeral]
				});
		}
	} catch (error) {
		await handleInteractionError(interaction, error, 'Failed to execute bait channel command');
	}
};
