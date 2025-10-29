/**
 * Profile Functions Module
 * 
 * Utilities for managing the bot's Discord profile settings including
 * status/presence and description/about me text.
 */

import { ActivityType, Client } from 'discord.js';
import pjson from '../../package.json';
import { lang } from './index';

// ============================================================================
// Status Functions
// ============================================================================

/**
 * Sets the bot's custom status/presence
 * @param client - The Discord client instance
 * @param isDev - Whether the bot is running in development mode
 * @example
 * // Call on bot ready event
 * setStatus(client, false); // Production
 * setStatus(client, true);  // Development
 */
export function setStatus(client: Client, isDev: boolean = false): void {
	const statusMessage = isDev 
		? '🔧 Development Mode' 
		: lang.general.presenceMsg;
	
	client.user?.setPresence({
		activities: [{
			name: 'Status',                  // Ignored for custom type
			type: ActivityType.Custom,       // Use custom presence
			state: statusMessage,            // Actual text shown in status
		}],
		status: isDev ? 'idle' : 'online'    // Yellow dot for dev, green for prod
	});
}

/**
 * Sets the bot's "About Me" description
 * @param client - The Discord client instance
 * @param isDev - Whether the bot is running in development mode
 * @example
 * // Call on bot ready event
 * setDescription(client, false); // Production
 * setDescription(client, true);  // Development
 */
export function setDescription(client: Client, isDev: boolean = false): void {
	const devPrefix = isDev ? '🔧 [DEV] ' : '';
	
	client.application?.edit({ 
		// Include bot version and description message
		description: `${devPrefix}v${pjson.version}\n\n${lang.general.descriptionMsg}`,
	});
}
