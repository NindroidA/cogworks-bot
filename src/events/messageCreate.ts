import { Client, Message } from 'discord.js';
import { BaitChannelManager } from '../utils/baitChannelManager';

export default {
	name: 'messageCreate',
	async execute(message: Message, client: Client) {
		if (!message.guild) return;
		
		// Get bait channel manager from client
		const { baitChannelManager } = client as { baitChannelManager?: BaitChannelManager };
		if (!baitChannelManager) return;
		
		// Track all messages for activity monitoring
		await baitChannelManager.trackMessage(message);
		
		// Handle bait channel
		await baitChannelManager.handleMessage(message);
	}
};
