/**
 * Announcement Templates System
 * Provides pre-built and custom announcement templates with embed support
 */

import { type ColorResolvable, EmbedBuilder } from 'discord.js';
import { lang } from '../../../utils';

const tpl = lang.announcement.templates;

// Template parameter types
export type TemplateParams =
  | { duration: 'short' | 'long'; customMessage?: string }
  | { duration: 'short' | 'long'; timestamp: number; customMessage?: string }
  | { version: string; timestamp: number; customMessage?: string }
  | { version: string; customMessage?: string }
  | { customMessage?: string }
  | {
      title?: string;
      description: string;
      color?: string;
      fields?: Array<{ name: string; value: string; inline?: boolean }>;
      footer?: string;
      timestamp?: boolean;
    }
  | Record<string, unknown>;

interface AnnouncementTemplate {
  id: string;
  name: string;
  description: string;
  color: ColorResolvable;
  buildEmbed: (
    params: TemplateParams,
    mentionRole?: string,
  ) => {
    embeds: EmbedBuilder[];
    content?: string;
  };
}

const BUILT_IN_TEMPLATES: Record<string, AnnouncementTemplate> = {
  maintenance: {
    id: 'maintenance',
    name: 'Maintenance (Immediate)',
    description: 'Announce immediate server maintenance',
    color: 0xffa500,
    buildEmbed: (params: TemplateParams, mentionRole?: string) => {
      const p = params as { duration: 'short' | 'long'; customMessage?: string };
      const tl = lang.announcement.maintenance;
      const isShort = p.duration === 'short';
      const durationText = isShort ? tpl.durationShort : tpl.durationLong;
      const defaultMessage = isShort ? tl.duration.short.msg : tl.duration.long.msg;

      const embed = new EmbedBuilder()
        .setTitle(`🔧 ${tpl.maintenanceTitle}`)
        .setDescription(p.customMessage || defaultMessage)
        .setColor(0xffa500)
        .addFields(
          { name: `⏱️ ${tpl.expectedDuration}`, value: durationText, inline: true },
          { name: `📅 ${tpl.starting}`, value: tpl.startingValue, inline: true },
        )
        .setFooter({ text: tpl.timezoneFooter });

      return { embeds: [embed], content: mentionRole };
    },
  },

  maintenanceScheduled: {
    id: 'maintenanceScheduled',
    name: 'Maintenance (Scheduled)',
    description: 'Announce scheduled server maintenance',
    color: 0xffa500,
    buildEmbed: (params: TemplateParams, mentionRole?: string) => {
      const p = params as { duration: 'short' | 'long'; timestamp: number; customMessage?: string };
      const isShort = p.duration === 'short';
      const durationText = isShort ? tpl.durationShort : tpl.durationLong;

      const embed = new EmbedBuilder()
        .setTitle(`🔧 ${tpl.scheduledMaintenanceTitle}`)
        .setDescription(p.customMessage || tpl.scheduledDefaultMsg)
        .setColor(0xffa500)
        .addFields(
          { name: `⏱️ ${tpl.expectedDuration}`, value: durationText, inline: true },
          { name: `📅 ${tpl.scheduledTime}`, value: `<t:${p.timestamp}:F>`, inline: false },
          { name: `🕐 ${tpl.relativeTime}`, value: `<t:${p.timestamp}:R>`, inline: false },
        )
        .setFooter({ text: tpl.timezoneFooter });

      return { embeds: [embed], content: mentionRole };
    },
  },

  backOnline: {
    id: 'backOnline',
    name: 'Back Online',
    description: 'Announce server is back online',
    color: 0x00ff00,
    buildEmbed: (params: TemplateParams, mentionRole?: string) => {
      const p = params as { customMessage?: string };
      const tl = lang.announcement['back-online'];

      const embed = new EmbedBuilder()
        .setTitle(`✅ ${tpl.backOnlineTitle}`)
        .setDescription(p.customMessage || tl.success)
        .setColor(0x00ff00)
        .addFields(
          { name: `🎮 ${tpl.status}`, value: tpl.statusOnline, inline: true },
          {
            name: `⏰ ${tpl.downtimeComplete}`,
            value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
            inline: true,
          },
        )
        .setFooter({ text: tpl.timezoneFooter });

      return { embeds: [embed], content: mentionRole };
    },
  },

  updateScheduled: {
    id: 'updateScheduled',
    name: 'Update (Scheduled)',
    description: 'Announce scheduled server update',
    color: 0x5865f2,
    buildEmbed: (params: TemplateParams, mentionRole?: string) => {
      const p = params as { version: string; timestamp: number; customMessage?: string };
      const tl = lang.announcement['update-scheduled'];
      const defaultMessage = `The server will be updating to **${p.version}** later today. ${tl.msg}`;

      const embed = new EmbedBuilder()
        .setTitle(`📦 ${tpl.updateScheduledTitle}`)
        .setDescription(p.customMessage || defaultMessage)
        .setColor(0x5865f2)
        .addFields(
          { name: `📌 ${tpl.version}`, value: p.version, inline: true },
          { name: `📅 ${tpl.scheduledTime}`, value: `<t:${p.timestamp}:F>`, inline: false },
          { name: `🕐 ${tpl.relativeTime}`, value: `<t:${p.timestamp}:R>`, inline: false },
        )
        .setFooter({ text: tpl.timezoneFooter });

      return { embeds: [embed], content: mentionRole };
    },
  },

  updateComplete: {
    id: 'updateComplete',
    name: 'Update Complete',
    description: 'Announce completed server update',
    color: 0x00ff00,
    buildEmbed: (params: TemplateParams, mentionRole?: string) => {
      const p = params as { version: string; customMessage?: string };
      const tl = lang.announcement['update-complete'];
      const defaultMessage = `The server has been successfully updated to **version ${p.version}**!\n\n${tl.msg}`;

      const embed = new EmbedBuilder()
        .setTitle(`✅ ${tpl.updateCompleteTitle}`)
        .setDescription(p.customMessage || defaultMessage)
        .setColor(0x00ff00)
        .addFields(
          { name: `📌 ${tpl.newVersion}`, value: p.version, inline: true },
          { name: `🎮 ${tpl.status}`, value: tpl.statusOnline, inline: true },
          {
            name: `⏰ ${tpl.updated}`,
            value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
            inline: false,
          },
        )
        .setFooter({ text: tpl.timezoneFooter });

      return { embeds: [embed], content: mentionRole };
    },
  },

  custom: {
    id: 'custom',
    name: 'Custom Announcement',
    description: 'Create a custom announcement with your own content',
    color: 0x5865f2,
    buildEmbed: (params: TemplateParams, mentionRole?: string) => {
      const p = params as {
        title?: string;
        description: string;
        color?: string;
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
        footer?: string;
        timestamp?: boolean;
      };

      const embed = new EmbedBuilder()
        .setDescription(p.description)
        .setTimestamp(p.timestamp ? new Date() : null);

      if (p.title) embed.setTitle(p.title);
      if (p.color) {
        const colorValue = p.color.startsWith('#')
          ? parseInt(p.color.slice(1), 16)
          : parseInt(p.color, 16);
        embed.setColor(colorValue);
      } else {
        embed.setColor(0x5865f2);
      }
      if (p.fields && p.fields.length > 0) embed.addFields(p.fields);
      if (p.footer) embed.setFooter({ text: p.footer });

      return { embeds: [embed], content: mentionRole };
    },
  },
};

export function getTemplate(templateId: string): AnnouncementTemplate | null {
  return BUILT_IN_TEMPLATES[templateId] || null;
}

export function validateTemplateParams(
  templateId: string,
  params: TemplateParams,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  switch (templateId) {
    case 'maintenance':
    case 'maintenanceScheduled': {
      const p = params as { duration?: string; timestamp?: number };
      if (!p.duration || !['short', 'long'].includes(p.duration)) {
        errors.push('Duration must be "short" or "long"');
      }
      if (templateId === 'maintenanceScheduled' && !p.timestamp) {
        errors.push('Timestamp is required for scheduled maintenance');
      }
      break;
    }
    case 'updateScheduled': {
      const p = params as { version?: string; timestamp?: number };
      if (!p.version) errors.push('Version is required');
      if (!p.timestamp) errors.push('Timestamp is required');
      break;
    }
    case 'updateComplete': {
      const p = params as { version?: string };
      if (!p.version) errors.push('Version is required');
      break;
    }
    case 'custom': {
      const p = params as { description?: string };
      if (!p.description) errors.push('Description is required');
      break;
    }
    case 'backOnline':
      break;
    default:
      errors.push(`Unknown template: ${templateId}`);
  }

  return { valid: errors.length === 0, errors };
}
