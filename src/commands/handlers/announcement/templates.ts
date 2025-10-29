/**
 * Announcement Templates System
 * Provides pre-built and custom announcement templates with embed support
 */

import { ColorResolvable, EmbedBuilder } from 'discord.js';
import { lang } from '../../../utils';

// Template parameter types
export type TemplateParams = 
    | { duration: 'short' | 'long' }
    | { duration: 'short' | 'long'; timestamp: number }
    | { version: string; timestamp: number }
    | { version: string }
    | {
        title?: string;
        description: string;
        color?: string;
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
        footer?: string;
        timestamp?: boolean;
    }
    | Record<string, unknown>;

export interface AnnouncementTemplate {
    id: string;
    name: string;
    description: string;
    color: ColorResolvable;
    /**
     * Build the embed for this template
     * @param params - Template-specific parameters
     * @param mentionRole - Role to mention (if any)
     */
    buildEmbed: (params: TemplateParams, mentionRole?: string) => {
        embeds: EmbedBuilder[];
        content?: string;
    };
}

/**
 * Pre-built announcement templates
 */
export const BUILT_IN_TEMPLATES: Record<string, AnnouncementTemplate> = {
    maintenance: {
        id: 'maintenance',
        name: 'Maintenance (Immediate)',
        description: 'Announce immediate server maintenance',
        color: 0xFFA500, // Orange
        buildEmbed: (params: TemplateParams, mentionRole?: string) => {
            const p = params as { duration: 'short' | 'long' };
            const tl = lang.announcement.maintenance;
            const isShort = p.duration === 'short';
            const durationText = isShort ? '5-10 minutes' : 'up to 1 hour or more';
            const messageText = isShort ? tl.duration.short.msg : tl.duration.long.msg;

            const embed = new EmbedBuilder()
                .setTitle('🔧 Server Maintenance')
                .setDescription(messageText)
                .setColor(0xFFA500)
                .addFields(
                    { name: '⏱️ Expected Duration', value: durationText, inline: true },
                    { name: '📅 Starting', value: 'In about 5 minutes', inline: true }
                )
                .setFooter({ text: 'Thank you for your patience!' })
                .setTimestamp();

            return {
                embeds: [embed],
                content: mentionRole
            };
        }
    },

    maintenanceScheduled: {
        id: 'maintenanceScheduled',
        name: 'Maintenance (Scheduled)',
        description: 'Announce scheduled server maintenance',
        color: 0xFFA500,
        buildEmbed: (params: TemplateParams, mentionRole?: string) => {
            const p = params as { duration: 'short' | 'long'; timestamp: number };
            const isShort = p.duration === 'short';
            const durationText = isShort ? '5-10 minutes' : 'up to 1 hour';

            const embed = new EmbedBuilder()
                .setTitle('🔧 Scheduled Server Maintenance')
                .setDescription(
                    'The Minecraft server will be going down for server-side maintenance and updates. ' +
                    'We will update this channel if anything goes awry.'
                )
                .setColor(0xFFA500)
                .addFields(
                    { name: '⏱️ Expected Duration', value: durationText, inline: true },
                    { name: '📅 Scheduled Time', value: `<t:${p.timestamp}:F>`, inline: false },
                    { name: '🕐 Relative Time', value: `<t:${p.timestamp}:R>`, inline: false }
                )
                .setFooter({ text: 'Times shown are in your local timezone • Thank you for your patience!' })
                .setTimestamp();

            return {
                embeds: [embed],
                content: mentionRole
            };
        }
    },

    backOnline: {
        id: 'backOnline',
        name: 'Back Online',
        description: 'Announce server is back online',
        color: 0x00FF00, // Green
        buildEmbed: (params: TemplateParams, mentionRole?: string) => {
            const tl = lang.announcement['back-online'];

            const embed = new EmbedBuilder()
                .setTitle('✅ Server is Back Online!')
                .setDescription(tl.success)
                .setColor(0x00FF00)
                .addFields(
                    { name: '🎮 Status', value: 'Online and ready', inline: true },
                    { name: '⏰ Downtime Complete', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: 'Thank you for your patience!' })
                .setTimestamp();

            return {
                embeds: [embed],
                content: mentionRole
            };
        }
    },

    updateScheduled: {
        id: 'updateScheduled',
        name: 'Update (Scheduled)',
        description: 'Announce scheduled server update',
        color: 0x5865F2, // Discord Blurple
        buildEmbed: (params: TemplateParams, mentionRole?: string) => {
            const p = params as { version: string; timestamp: number };
            const tl = lang.announcement['update-scheduled'];

            const embed = new EmbedBuilder()
                .setTitle('📦 Scheduled Server Update')
                .setDescription(
                    `The server will be updating to **${p.version}** later today. ` +
                    tl.msg
                )
                .setColor(0x5865F2)
                .addFields(
                    { name: '📌 Version', value: p.version, inline: true },
                    { name: '📅 Scheduled Time', value: `<t:${p.timestamp}:F>`, inline: false },
                    { name: '🕐 Relative Time', value: `<t:${p.timestamp}:R>`, inline: false }
                )
                .setFooter({ text: 'Times shown are in your local timezone' })
                .setTimestamp();

            return {
                embeds: [embed],
                content: mentionRole
            };
        }
    },

    updateComplete: {
        id: 'updateComplete',
        name: 'Update Complete',
        description: 'Announce completed server update',
        color: 0x00FF00,
        buildEmbed: (params: TemplateParams, mentionRole?: string) => {
            const p = params as { version: string };
            const tl = lang.announcement['update-complete'];

            const embed = new EmbedBuilder()
                .setTitle('✅ Server Update Complete!')
                .setDescription(
                    `The server has been successfully updated to **version ${p.version}**!\n\n` +
                    tl.msg
                )
                .setColor(0x00FF00)
                .addFields(
                    { name: '📌 New Version', value: p.version, inline: true },
                    { name: '🎮 Status', value: 'Online and ready', inline: true },
                    { name: '⏰ Updated', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }
                )
                .setFooter({ text: 'Thank you for your patience!' })
                .setTimestamp();

            return {
                embeds: [embed],
                content: mentionRole
            };
        }
    },

    custom: {
        id: 'custom',
        name: 'Custom Announcement',
        description: 'Create a custom announcement with your own content',
        color: 0x5865F2,
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
                // Parse color (hex string or number)
                const colorValue = p.color.startsWith('#')
                    ? parseInt(p.color.slice(1), 16)
                    : parseInt(p.color, 16);
                embed.setColor(colorValue);
            } else {
                embed.setColor(0x5865F2);
            }
            if (p.fields && p.fields.length > 0) {
                embed.addFields(p.fields);
            }
            if (p.footer) embed.setFooter({ text: p.footer });

            return {
                embeds: [embed],
                content: mentionRole
            };
        }
    }
};

/**
 * Get a template by ID
 */
export function getTemplate(templateId: string): AnnouncementTemplate | null {
    return BUILT_IN_TEMPLATES[templateId] || null;
}

/**
 * Get all available templates
 */
export function getAllTemplates(): AnnouncementTemplate[] {
    return Object.values(BUILT_IN_TEMPLATES);
}

/**
 * Validate template parameters
 */
export function validateTemplateParams(
    templateId: string,
    params: TemplateParams
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
            if (!p.version) {
                errors.push('Version is required');
            }
            if (!p.timestamp) {
                errors.push('Timestamp is required');
            }
            break;
        }

        case 'updateComplete': {
            const p = params as { version?: string };
            if (!p.version) {
                errors.push('Version is required');
            }
            break;
        }

        case 'custom': {
            const p = params as { description?: string };
            if (!p.description) {
                errors.push('Description is required');
            }
            break;
        }

        case 'backOnline':
            // No required params
            break;

        default:
            errors.push(`Unknown template: ${templateId}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
