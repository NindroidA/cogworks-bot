/**
 * Channel Defaults
 *
 * Default channel and category names, emojis, and types for each system.
 * Edit this file to customize the names that appear when auto-creating channels.
 *
 * Each system defines its channel templates with:
 *   - baseName: The display name (formatted by the channel creator)
 *   - type: Discord channel type (GuildText, GuildForum, GuildCategory, GuildAnnouncement)
 *   - defaultEmoji: Emoji prefix (used if the guild's format includes emoji prefixes)
 *   - staffOnly: Whether the channel/category should be hidden from non-staff
 */

import { ChannelType } from 'discord.js';

export interface ChannelTemplate {
  baseName: string;
  type: ChannelType.GuildText | ChannelType.GuildForum | ChannelType.GuildCategory | ChannelType.GuildAnnouncement;
  defaultEmoji?: string;
  staffOnly?: boolean;
}

export type SystemType = 'ticket' | 'application' | 'memory' | 'bait' | 'announcement' | 'rules';

/**
 * Default channel templates per system.
 *
 * Template keys have special meaning:
 *   - "category"        → Main parent category for the system's channels
 *   - "threadCategory"  → Secondary category where active threads/tickets populate
 *   - Other keys        → Non-category channels placed under the main category
 */
export const SYSTEM_CHANNELS: Record<SystemType, Record<string, ChannelTemplate>> = {
  // ─── Ticket System ──────────────────────────────────────────────────
  ticket: {
    category: {
      baseName: 'Tickets',
      type: ChannelType.GuildCategory,
      defaultEmoji: '🎫',
      staffOnly: true,
    },
    button: {
      baseName: 'tickets',
      type: ChannelType.GuildText,
      defaultEmoji: '🎫',
    },
    archive: {
      baseName: 'ticket archive',
      type: ChannelType.GuildForum,
      defaultEmoji: '📁',
    },
    threadCategory: {
      baseName: 'Open Tickets',
      type: ChannelType.GuildCategory,
      defaultEmoji: '🎫',
      staffOnly: true,
    },
  },

  // ─── Application System ─────────────────────────────────────────────
  application: {
    category: {
      baseName: 'Applications',
      type: ChannelType.GuildCategory,
      defaultEmoji: '📋',
      staffOnly: true,
    },
    button: {
      baseName: 'applications',
      type: ChannelType.GuildText,
      defaultEmoji: '📋',
    },
    archive: {
      baseName: 'application archive',
      type: ChannelType.GuildForum,
      defaultEmoji: '📁',
    },
    threadCategory: {
      baseName: 'Open Applications',
      type: ChannelType.GuildCategory,
      defaultEmoji: '📋',
      staffOnly: true,
    },
  },

  // ─── Memory System ──────────────────────────────────────────────────
  memory: {
    category: {
      baseName: 'Memory',
      type: ChannelType.GuildCategory,
      defaultEmoji: '🧠',
    },
    forum: {
      baseName: 'memory',
      type: ChannelType.GuildForum,
      defaultEmoji: '🧠',
    },
  },

  // ─── Bait Channel System ───────────────────────────────────────────
  bait: {
    category: {
      baseName: 'Bait',
      type: ChannelType.GuildCategory,
      defaultEmoji: '🛡️',
      staffOnly: true,
    },
    channel: {
      baseName: 'honeypot',
      type: ChannelType.GuildText,
      defaultEmoji: '⚠️',
    },
    log: {
      baseName: 'bait logs',
      type: ChannelType.GuildText,
      defaultEmoji: '📋',
      staffOnly: true,
    },
  },

  // ─── Announcement System ───────────────────────────────────────────
  announcement: {
    category: {
      baseName: 'Info',
      type: ChannelType.GuildCategory,
      defaultEmoji: '📢',
    },
    channel: {
      baseName: 'announcements',
      type: ChannelType.GuildAnnouncement,
      defaultEmoji: '📢',
    },
  },

  // ─── Rules System ──────────────────────────────────────────────────
  rules: {
    category: {
      baseName: 'Info',
      type: ChannelType.GuildCategory,
      defaultEmoji: '📜',
    },
    channel: {
      baseName: 'rules',
      type: ChannelType.GuildText,
      defaultEmoji: '📜',
    },
  },
};

/**
 * Bait channel warning message posted in the trap channel.
 * Edit this to customize the message users see.
 */
export const BAIT_CHANNEL_WARNING =
  '# 🚨 **DO NOT POST HERE** 🚨\n\n' +
  'Not for fun. Not to "test" it. Not even as a joke.\n\n' +
  'This channel is monitored for bot detection.\n\n' +
  'If you post anything in here, our system will assume you are a bot and you **WILL BE BANNED**. No ifs, ands, or buts.\n\n' +
  'If you are a legitimate user, please do not post here. This is your only warning.';

/**
 * Default memory forum tags seeded on first setup.
 * Edit names/emojis here to change what tags new memory channels start with.
 */
export const DEFAULT_MEMORY_TAGS = {
  category: [
    { name: 'Bug', emoji: '🐛' },
    { name: 'Feature', emoji: '✨' },
    { name: 'Suggestion', emoji: '💡' },
    { name: 'Reminder', emoji: '⏰' },
    { name: 'Note', emoji: '📝' },
  ],
  status: [
    { name: 'Open', emoji: '📋' },
    { name: 'In Progress', emoji: '🔧' },
    { name: 'On Hold', emoji: '⏸️' },
    { name: 'Completed', emoji: '✅' },
  ],
};
