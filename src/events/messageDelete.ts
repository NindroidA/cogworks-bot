import { Client, Message, PartialMessage } from 'discord.js';
import { BaitChannelManager } from '../utils/baitChannelManager';

export default {
	name: 'messageDelete',
	async execute(message: Message | PartialMessage, client: Client) {
		if (!message.guild) return;
		
		// Get bait channel manager from client
		const { baitChannelManager } = client as { baitChannelManager?: BaitChannelManager };
		if (!baitChannelManager) return;
		
		await baitChannelManager.handleMessageDelete(message.id, message.guild.id);
	}
};
