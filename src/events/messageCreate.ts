import { Client, Message } from 'discord.js';
import { enhancedLogger, LogCategory } from '../utils';
import { BaitChannelManager } from '../utils/baitChannelManager';

export default {
	name: 'messageCreate',
	async execute(message: Message, client: Client) {
		if (!message.guild) return;

		// Get bait channel manager from client
		const { baitChannelManager } = client as { baitChannelManager?: BaitChannelManager };
		if (!baitChannelManager) {
			enhancedLogger.debug('BaitChannelManager not available on client', LogCategory.SYSTEM);
			return;
		}

		// Track all messages for activity monitoring
		await baitChannelManager.trackMessage(message);

		// Handle bait channel
		await baitChannelManager.handleMessage(message);
	}
};
