import { ActivityType, Client } from 'discord.js';
import lang from './lang.json';

export function setStatus (client: Client) {
    client.user?.setPresence({
        activities: [{
            name: 'Status',                  // ignored for custom type
            type: ActivityType.Custom,       // set to be custom presense
            state: lang.general.presenceMsg, // actual text that shows as the status
        }],
        status: 'online'
    });
}