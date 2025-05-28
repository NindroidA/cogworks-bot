import { ActivityType, Client } from 'discord.js';
import pjson from '../../package.json';
import lang from './lang.json';

/* set the bot's status */
export function setStatus(client: Client) {
    client.user?.setPresence({
        activities: [{
            name: 'Status',                  // ignored for custom type
            type: ActivityType.Custom,       // set to be custom presense
            state: lang.general.presenceMsg, // actual text that shows as the status
        }],
        status: 'online'
    });
}

/* set the bot's about me (description) */
export function setDescription(client: Client) {
    client.application?.edit({ 
        // set description message and current bot version
        description: `v${pjson.version}\n\n${lang.general.descriptionMsg}`,
    });
}