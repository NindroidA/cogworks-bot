import { ChatInputCommandInteraction, Client, MessageFlags } from 'discord.js';
import { handleInteractionError, lang, requireAdmin } from '../../../utils';
import { detectionHandler } from './detection';
import { setupHandler } from './setup';
import { statsHandler } from './stats';
import { statusHandler } from './status';
import { toggleHandler } from './toggle';
import { whitelistHandler } from './whitelist';

export const baitChannelHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
	try {
		// Require admin permissions for all baitchannel subcommands
		if (!await requireAdmin(interaction)) return;

		const subcommand = interaction.options.getSubcommand();

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
