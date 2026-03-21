import type { Client } from 'discord.js';
import { EmbedBuilder, type TextChannel } from 'discord.js';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from '../../../typeorm/entities/announcement/AnnouncementLog';
import { AnnouncementTemplate } from '../../../typeorm/entities/announcement/AnnouncementTemplate';
import { renderTemplate, type TemplatePlaceholderParams } from '../../announcement/templateEngine';
import { MAX } from '../../constants';
import { lazyRepo } from '../../database/lazyRepo';
import { sanitizeUserInput } from '../../validation/inputSanitizer';
import { ApiError } from '../apiError';
import { isValidSnowflake, validateHexColor } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const announcementLogRepo = lazyRepo(AnnouncementLog);
const templateRepo = lazyRepo(AnnouncementTemplate);
const configRepo = lazyRepo(AnnouncementConfig);

export function registerAnnouncementHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
): void {
  // POST /internal/guilds/:guildId/announcements/send
  routes.set('POST /announcements/send', async (guildId, body) => {
    const channelId = body.channelId as string;
    if (!channelId) throw ApiError.badRequest('channelId is required');
    if (!isValidSnowflake(channelId)) throw ApiError.badRequest('Invalid channelId format');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw ApiError.notFound('Channel not found or not a text channel');
    }

    // If templateName is provided, use template system
    const templateName = body.templateName as string | undefined;
    if (templateName) {
      const template = await templateRepo.findOneBy({
        guildId,
        name: templateName,
      });
      if (!template) throw ApiError.notFound(`Template '${templateName}' not found`);

      const config = await configRepo.findOneBy({ guildId });
      const roleId = config?.defaultRoleId || config?.minecraftRoleId;

      const params: TemplatePlaceholderParams = {};
      const bodyParams = (body.params as Record<string, unknown>) || {};
      if (bodyParams.version) params.version = String(bodyParams.version);
      if (bodyParams.duration) params.duration = String(bodyParams.duration);
      if (bodyParams.time) params.time = Number(bodyParams.time);
      params.channelId = channelId;

      const rendered = renderTemplate(template, params, guild, null, roleId);

      const sentMessage = await (channel as TextChannel).send({
        content: rendered.content,
        embeds: rendered.embeds,
        allowedMentions: roleId ? { roles: [roleId] } : undefined,
      });

      const sentBy = (body.sentBy as string) || 'dashboard';
      await announcementLogRepo.save(
        announcementLogRepo.create({
          guildId,
          channelId,
          messageId: sentMessage.id,
          type: templateName,
          sentBy,
        }),
      );

      await writeAuditLog(guildId, 'announcement.send', body.triggeredBy as string, {
        channelId,
        messageId: sentMessage.id,
        template: templateName,
      });
      return { success: true, messageId: sentMessage.id };
    }

    // Legacy: custom title + description
    const title = sanitizeUserInput(body.title as string);
    const description = sanitizeUserInput(body.description as string);
    if (!title || !description) {
      throw ApiError.badRequest(
        'channelId, title, and description are required (or provide templateName)',
      );
    }

    const color = (body.color as string) || '#5865F2';
    const colorError = validateHexColor(color);
    if (colorError) throw ApiError.badRequest(colorError);

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

  // GET /internal/guilds/:guildId/announcements/templates
  routes.set('GET /announcements/templates', async guildId => {
    const templates = await templateRepo.find({
      where: { guildId },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
    return { templates };
  });

  // POST /internal/guilds/:guildId/announcements/templates
  routes.set('POST /announcements/templates', async (guildId, body) => {
    const name = ((body.name as string) || '').toLowerCase().trim();
    const displayName = sanitizeUserInput(body.displayName as string);
    const title = sanitizeUserInput(body.title as string);
    const templateBody = sanitizeUserInput(body.body as string);

    if (!name || !displayName || !title || !templateBody) {
      throw ApiError.badRequest('name, displayName, title, and body are required');
    }

    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw ApiError.badRequest('Name must be lowercase alphanumeric with hyphens only');
    }

    // Check limit
    const count = await templateRepo.count({ where: { guildId } });
    if (count >= MAX.ANNOUNCEMENT_TEMPLATES) {
      throw ApiError.conflict(`Maximum ${MAX.ANNOUNCEMENT_TEMPLATES} templates reached`);
    }

    // Check duplicate
    const existing = await templateRepo.findOneBy({ guildId, name });
    if (existing) {
      throw ApiError.conflict(`Template '${name}' already exists`);
    }

    const color = (body.color as string) || '#5865F2';
    const colorError = validateHexColor(color);
    if (colorError) throw ApiError.badRequest(colorError);

    const template = templateRepo.create({
      guildId,
      name,
      displayName,
      title,
      body: templateBody,
      color: color.toUpperCase(),
      description: sanitizeUserInput(body.description as string) || null,
      footerText: sanitizeUserInput(body.footerText as string) || null,
      showTimestamp: body.showTimestamp !== false,
      mentionRole: body.mentionRole === true,
      isDefault: false,
      createdBy: (body.triggeredBy as string) || null,
    });

    await templateRepo.save(template);

    await writeAuditLog(guildId, 'announcement.template.create', body.triggeredBy as string, {
      templateName: name,
    });
    return { success: true, template };
  });

  // POST /internal/guilds/:guildId/announcements/templates/delete
  routes.set('POST /announcements/templates/delete', async (guildId, body) => {
    const name = body.name as string;
    if (!name) throw ApiError.badRequest('name is required');

    const template = await templateRepo.findOneBy({ guildId, name });
    if (!template) throw ApiError.notFound(`Template '${name}' not found`);
    if (template.isDefault) throw ApiError.conflict('Default templates cannot be deleted');

    await templateRepo.remove(template);

    await writeAuditLog(guildId, 'announcement.template.delete', body.triggeredBy as string, {
      templateName: name,
    });
    return { success: true };
  });
}
