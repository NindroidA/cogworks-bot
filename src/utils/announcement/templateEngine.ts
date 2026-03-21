/**
 * Announcement Template Engine
 *
 * Simple placeholder replacement for announcement templates.
 * No eval, no template libraries — just safe {word} regex replacement.
 */

import { EmbedBuilder, type Guild, type User } from 'discord.js';
import type { AnnouncementTemplate } from '../../typeorm/entities/announcement/AnnouncementTemplate';
import { sanitizeUserInput } from '../validation/inputSanitizer';

// ============================================================================
// Types
// ============================================================================

export interface TemplatePlaceholderParams {
  version?: string;
  duration?: string;
  time?: number; // Unix timestamp
  channelId?: string;
}

export interface RenderedAnnouncement {
  embeds: EmbedBuilder[];
  content?: string;
}

export interface PlaceholderInfo {
  name: string;
  description: string;
  example: string;
  requiresInput: boolean;
}

// ============================================================================
// Placeholder Metadata
// ============================================================================

const PLACEHOLDER_METADATA: PlaceholderInfo[] = [
  {
    name: 'version',
    description: 'Version string (e.g., 1.21.5)',
    example: '1.21.5',
    requiresInput: true,
  },
  {
    name: 'duration',
    description: 'Duration description (e.g., 5-10 minutes)',
    example: '5-10 minutes',
    requiresInput: true,
  },
  {
    name: 'time',
    description: 'Discord full date/time timestamp',
    example: '<t:1700000000:F>',
    requiresInput: true,
  },
  {
    name: 'time_relative',
    description: 'Discord relative timestamp (e.g., "in 2 hours")',
    example: '<t:1700000000:R>',
    requiresInput: true,
  },
  {
    name: 'user',
    description: 'Mention of the user sending the announcement',
    example: '@User',
    requiresInput: false,
  },
  {
    name: 'role',
    description: 'Mention of the configured announcement role',
    example: '@Role',
    requiresInput: false,
  },
  {
    name: 'server',
    description: 'Server/guild name',
    example: 'My Server',
    requiresInput: false,
  },
  {
    name: 'channel',
    description: 'Channel mention where announcement is sent',
    example: '#announcements',
    requiresInput: false,
  },
];

/**
 * Returns metadata about all available placeholders.
 */
export function getAvailablePlaceholders(): PlaceholderInfo[] {
  return PLACEHOLDER_METADATA;
}

/**
 * Detects which placeholders requiring user input are present in a template.
 */
export function detectDynamicPlaceholders(template: AnnouncementTemplate): PlaceholderInfo[] {
  const allText = [
    template.title,
    template.body,
    ...(template.fields?.flatMap(f => [f.name, f.value]) ?? []),
  ].join(' ');

  return PLACEHOLDER_METADATA.filter(p => p.requiresInput && allText.includes(`{${p.name}}`));
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Replace {placeholder} tokens in a string with corresponding values.
 * Unknown placeholders pass through unchanged.
 */
function renderPlaceholders(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match);
}

/**
 * Build the resolved params map from user inputs and context.
 * All user-provided values are sanitized before inclusion.
 */
function buildParamsMap(
  params: TemplatePlaceholderParams,
  guild: Guild | null,
  user: User | null,
  roleId?: string | null,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  if (params.version) {
    resolved.version = sanitizeUserInput(params.version);
  }
  if (params.duration) {
    resolved.duration = sanitizeUserInput(params.duration);
  }
  if (params.time != null) {
    resolved.time = `<t:${params.time}:F>`;
    resolved.time_relative = `<t:${params.time}:R>`;
  }
  if (user) {
    resolved.user = `<@${user.id}>`;
  }
  if (roleId) {
    resolved.role = `<@&${roleId}>`;
  }
  if (guild) {
    resolved.server = guild.name;
  }
  if (params.channelId) {
    resolved.channel = `<#${params.channelId}>`;
  }

  return resolved;
}

/**
 * Render an AnnouncementTemplate into a ready-to-send message.
 *
 * @param template - The template entity
 * @param params - User-provided placeholder values
 * @param guild - The guild context (for {server})
 * @param user - The user sending (for {user})
 * @param roleId - The announcement role ID (for {role} and content mention)
 * @returns Rendered message with embeds and optional content
 */
export function renderTemplate(
  template: AnnouncementTemplate,
  params: TemplatePlaceholderParams,
  guild: Guild | null,
  user: User | null,
  roleId?: string | null,
): RenderedAnnouncement {
  const resolvedParams = buildParamsMap(params, guild, user, roleId);

  const renderedTitle = renderPlaceholders(template.title, resolvedParams);
  const renderedBody = renderPlaceholders(template.body, resolvedParams);

  const embed = new EmbedBuilder()
    .setTitle(renderedTitle)
    .setDescription(renderedBody)
    .setColor(Number.parseInt(template.color.replace('#', ''), 16));

  // Render fields
  if (template.fields && template.fields.length > 0) {
    for (const field of template.fields) {
      embed.addFields({
        name: renderPlaceholders(field.name, resolvedParams),
        value: renderPlaceholders(field.value, resolvedParams),
        inline: field.inline,
      });
    }
  }

  // Footer
  if (template.footerText) {
    embed.setFooter({ text: renderPlaceholders(template.footerText, resolvedParams) });
  }

  // Timestamp
  if (template.showTimestamp) {
    embed.setTimestamp(new Date());
  }

  // Content: mention role if configured
  const content = template.mentionRole && roleId ? `<@&${roleId}>` : undefined;

  return { embeds: [embed], content };
}

/**
 * Render a template with example values for preview purposes.
 */
export function renderPreview(
  template: AnnouncementTemplate,
  guild: Guild | null,
  user: User | null,
  roleId?: string | null,
): RenderedAnnouncement {
  const now = Math.floor(Date.now() / 1000);
  const exampleParams: TemplatePlaceholderParams = {
    version: '1.0.0',
    duration: '5-10 minutes',
    time: now,
    channelId: '000000000000000000',
  };

  return renderTemplate(template, exampleParams, guild, user, roleId);
}
