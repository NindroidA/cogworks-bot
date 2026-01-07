import { ColorResolvable, Colors as DiscordColors } from 'discord.js';

/**
 * Centralized color system for all embeds
 * Uses 'as const' pattern for type safety and tree-shaking
 * Organized by category for easy maintenance and scaling
 */
export const Colors = {
    // Status indicators
    status: {
        success: '#57F287' as ColorResolvable,   // Discord green
        error: '#ED4245' as ColorResolvable,     // Discord red
        warning: '#FEE75C' as ColorResolvable,   // Discord yellow
        info: '#5865F2' as ColorResolvable,      // Discord blurple
        neutral: '#99AAB5' as ColorResolvable,   // Discord grey
    },

    // Severity levels (for logs, alerts)
    severity: {
        critical: '#ED4245' as ColorResolvable,
        high: '#ff6b6b' as ColorResolvable,
        medium: '#FEE75C' as ColorResolvable,
        low: '#57F287' as ColorResolvable,
    },

    // Moderation actions
    moderation: {
        ban: '#ED4245' as ColorResolvable,
        kick: '#ff6b6b' as ColorResolvable,
        timeout: '#FEE75C' as ColorResolvable,
        warn: '#FEE75C' as ColorResolvable,
        unban: '#57F287' as ColorResolvable,
    },

    // Bait channel system
    bait: {
        detected: '#ED4245' as ColorResolvable,
        whitelisted: '#FEE75C' as ColorResolvable,
        protected: {
            owner: '#9b59b6' as ColorResolvable,
            admin: '#3498db' as ColorResolvable,
            staff: '#57F287' as ColorResolvable,
        },
        enabled: '#57F287' as ColorResolvable,
        disabled: '#99AAB5' as ColorResolvable,
    },

    // Ticket system
    ticket: {
        created: '#5865F2' as ColorResolvable,
        closed: '#99AAB5' as ColorResolvable,
        adminOnly: '#9b59b6' as ColorResolvable,
        // Default type colors
        types: {
            banAppeal: '#ff6b6b' as ColorResolvable,
            playerReport: '#ffd93d' as ColorResolvable,
            bugReport: '#6bcf7f' as ColorResolvable,
            verification: '#a29bfe' as ColorResolvable,
            other: '#5865F2' as ColorResolvable,
        },
    },

    // Application system
    application: {
        pending: '#FEE75C' as ColorResolvable,
        approved: '#57F287' as ColorResolvable,
        denied: '#ED4245' as ColorResolvable,
        review: '#5865F2' as ColorResolvable,
    },

    // Announcement system
    announcement: {
        maintenance: '#FEE75C' as ColorResolvable,
        update: '#5865F2' as ColorResolvable,
        online: '#57F287' as ColorResolvable,
    },

    // Bot setup wizard
    setup: {
        step: '#5865F2' as ColorResolvable,
        complete: '#57F287' as ColorResolvable,
        error: '#ED4245' as ColorResolvable,
        skip: '#99AAB5' as ColorResolvable,
    },

    // Brand colors
    brand: {
        primary: '#5865F2' as ColorResolvable,
        secondary: '#99AAB5' as ColorResolvable,
        accent: '#57F287' as ColorResolvable,
    },
} as const;

// Type helpers for consuming the colors
export type ColorCategory = keyof typeof Colors;
export type StatusColor = keyof typeof Colors.status;
export type SeverityColor = keyof typeof Colors.severity;
export type ModerationColor = keyof typeof Colors.moderation;
export type BaitColor = keyof typeof Colors.bait;
export type TicketColor = keyof typeof Colors.ticket;
export type ApplicationColor = keyof typeof Colors.application;
export type AnnouncementColor = keyof typeof Colors.announcement;
export type SetupColor = keyof typeof Colors.setup;
export type BrandColor = keyof typeof Colors.brand;

// Re-export Discord.js colors for convenience
export { DiscordColors };

// Default export for convenience
export default Colors;
