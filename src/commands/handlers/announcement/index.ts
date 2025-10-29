/**
 * Announcement Handler (Modernized)
 * Delegates to the new modernized handler with template system and preview
 */

import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { announcementHandler as modernAnnouncementHandler } from './handler';

export const announcementHandler = async(
    client: Client,
    interaction: ChatInputCommandInteraction<CacheType>
) => {
    // Delegate to modernized handler
    await modernAnnouncementHandler(client, interaction);
};
