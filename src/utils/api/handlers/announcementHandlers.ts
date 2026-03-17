import type { Client } from 'discord.js';
import { EmbedBuilder, type TextChannel } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementLog } from '../../../typeorm/entities/announcement/AnnouncementLog';
import { isValidSnowflake, validateHexColor } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const announcementLogRepo = AppDataSource.getRepository(AnnouncementLog);

export function registerAnnouncementHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
): void {
  // POST /internal/guilds/:guildId/announcements/send
  routes.set('POST /announcements/send', async (guildId, body) => {
    const channelId = body.channelId as string;
    const title = body.title as string;
    const description = body.description as string;
    if (!channelId || !title || !description) {
      return { error: 'channelId, title, and description are required' };
    }
    if (!isValidSnowflake(channelId)) return { error: 'Invalid channelId format' };

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { error: 'Guild not found' };

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return { error: 'Channel not found or not a text channel' };
    }

    const color = (body.color as string) || '#5865F2';
    const colorError = validateHexColor(color);
    if (colorError) return { error: colorError };

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(Number.parseInt(color.replace('#', ''), 16))
      .setTimestamp();

    const mentionRoleId = body.mentionRoleId as string | undefined;
    const content = mentionRoleId ? `<@&${mentionRoleId}>` : undefined;

    const sentMessage = await (channel as TextChannel).send({
      content,
      embeds: [embed],
      allowedMentions: mentionRoleId ? { roles: [mentionRoleId] } : undefined,
    });

    // Log announcement
    const sentBy = (body.sentBy as string) || 'dashboard';
    await announcementLogRepo.save(
      announcementLogRepo.create({
        guildId,
        channelId,
        messageId: sentMessage.id,
        type: 'dashboard',
        sentBy,
      }),
    );

    await writeAuditLog(guildId, 'announcement.send', body.triggeredBy as string, {
      channelId,
      messageId: sentMessage.id,
    });
    return { success: true, messageId: sentMessage.id };
  });
}
