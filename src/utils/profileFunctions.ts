/**
 * Profile Functions Module
 *
 * Utilities for managing the bot's Discord profile settings including
 * status/presence and description/about me text.
 */

import { ActivityType, type Client } from 'discord.js';
import pjson from '../../package.json';
import { lang } from '../lang';

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
  const messages = lang.general.presenceMessages;
  const statusMessage = isDev
    ? '🔧 Development Mode'
    : messages[Math.floor(Math.random() * messages.length)];

  client.user?.setPresence({
    activities: [
      {
        name: 'Status', // Ignored for custom type
        type: ActivityType.Custom, // Use custom presence
        state: statusMessage, // Actual text shown in status
      },
    ],
    status: isDev ? 'idle' : 'online', // Yellow dot for dev, green for prod
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
  const dashboardURL = process.env.DASHBOARD_URL || 'https://cogworks.nindroidsystems.com';

  client.application?.edit({
    // Include bot version, dashboard url, and description message
    description: `${devPrefix}v${pjson.version}\n${dashboardURL}\n\n${lang.general.descriptionMsg}`,
  });
}
