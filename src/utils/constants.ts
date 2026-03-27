/**
 * Centralized constants for the Cogworks Bot.
 *
 * All magic numbers, cache TTLs, intervals, retention periods, max counts,
 * timeouts, and text limits are defined here as the single source of truth.
 */

import type { WorkflowStatus } from '../typeorm/entities/ticket/TicketConfig';

export const CACHE_TTL = {
  /** Bait channel config cache: 5 minutes */
  BAIT_CONFIG: 5 * 60 * 1000,
  /** Reaction role menu cache: 30 minutes */
  REACTION_ROLE_MENU: 30 * 60 * 1000,
  /** Rules reaction config cache: 30 minutes */
  RULES: 30 * 60 * 1000,
  /** Field draft cache (field manager): 5 minutes */
  FIELD_DRAFT: 5 * 60 * 1000,
  /** Starboard config cache: 5 minutes */
  STARBOARD_CONFIG: 5 * 60 * 1000,
  /** XP config cache: 5 minutes */
  XP_CONFIG: 5 * 60 * 1000,
  /** Onboarding config cache: 10 minutes */
  ONBOARDING_CONFIG: 10 * 60 * 1000,
  /** Event config cache: 10 minutes */
  EVENT_CONFIG: 10 * 60 * 1000,
  /** Analytics config cache: 10 minutes */
  ANALYTICS_CONFIG: 10 * 60 * 1000,
} as const;

export const INTERVALS = {
  /** Bait channel activity buffer flush: 30 seconds */
  ACTIVITY_FLUSH: 30_000,
  /** Log cleanup (bait, announcement, audit, join events): 24 hours */
  LOG_CLEANUP: 24 * 60 * 60 * 1000,
  /** Join velocity tracker stale data sweep: 60 seconds */
  JOIN_VELOCITY_CLEANUP: 60_000,
  /** Field draft cache cleanup: 60 seconds */
  FIELD_DRAFT_CLEANUP: 60_000,
  /** Health status logging: 5 minutes */
  HEALTH_STATUS: 300_000,
  /** Weekly summary check (fires Sunday 00:xx UTC): 1 hour */
  WEEKLY_SUMMARY: 3_600_000,
  /** Rate limiter expired entry cleanup: 5 minutes */
  RATE_LIMIT_CLEANUP: 5 * 60 * 1000,
  /** Auto-close ticket check: 1 hour */
  AUTO_CLOSE_CHECK: 3_600_000,
  /** SLA breach check: 1 hour */
  SLA_CHECK: 3_600_000,
  /** Event reminder check: 1 hour */
  REMINDER_CHECK: 3_600_000,
  /** Analytics snapshot flush: 24 hours (daily at midnight UTC) */
  ANALYTICS_SNAPSHOT: 24 * 60 * 60 * 1000,
} as const;

export const RETENTION_DAYS = {
  /** Bait channel logs: 90 days */
  BAIT_LOG: 90,
  /** Announcement logs: 365 days */
  ANNOUNCEMENT_LOG: 365,
  /** Audit logs (dashboard actions): 90 days */
  AUDIT_LOG: 90,
  /** Join events (velocity tracking): 7 days */
  JOIN_EVENT: 7,
  /** Analytics snapshots: 90 days */
  ANALYTICS_SNAPSHOT: 90,
  /** Import logs: 90 days */
  IMPORT_LOG: 90,
} as const;

export const MAX = {
  /** Memory forum channels per guild */
  MEMORY_CHANNELS_PER_GUILD: 3,
  /** Bait channel keywords per guild */
  BAIT_KEYWORDS_PER_GUILD: 50,
  /** Custom fields per entity (ticket type / application position) */
  CUSTOM_FIELDS_PER_ENTITY: 5,
  /** Options per reaction role menu (Discord reaction limit) */
  REACTION_ROLE_OPTIONS: 20,
  /** Reaction role menus per guild */
  REACTION_ROLE_MENUS: 25,
  /** Join velocity lazy-prune threshold per guild */
  JOIN_VELOCITY_ENTRIES: 1000,
  /** Internal API max request body size: 1 MB */
  API_BODY_SIZE: 1024 * 1024,
  /** Announcement templates per guild (Discord autocomplete limit) */
  ANNOUNCEMENT_TEMPLATES: 25,
  /** Embed fields per announcement template */
  ANNOUNCEMENT_TEMPLATE_FIELDS: 10,
  /** Memory category tags per channel */
  MEMORY_CATEGORY_TAGS: 10,
  /** Memory status tags per channel */
  MEMORY_STATUS_TAGS: 6,
  /** Memory tag name max length */
  MEMORY_TAG_NAME_LENGTH: 20,
  /** Hard Discord limit for forum tags per channel */
  DISCORD_FORUM_TAGS: 20,
  /** Max workflow statuses per guild */
  TICKET_WORKFLOW_STATUSES: 10,
  /** Max status history entries per ticket */
  TICKET_STATUS_HISTORY: 50,
  /** Max workflow statuses per application guild */
  APPLICATION_WORKFLOW_STATUSES: 10,
  /** Max status history entries per application */
  APPLICATION_STATUS_HISTORY: 50,
  /** Max internal notes per application */
  APPLICATION_INTERNAL_NOTES: 50,
  /** Starboard threshold min/max */
  STARBOARD_THRESHOLD_MIN: 1,
  STARBOARD_THRESHOLD_MAX: 25,
  /** Starboard ignored channels per guild */
  STARBOARD_IGNORED_CHANNELS: 50,
  /** XP role rewards per guild */
  XP_ROLE_REWARDS: 25,
  /** XP multiplier channels per guild */
  XP_MULTIPLIER_CHANNELS: 25,
  /** XP ignored channels per guild */
  XP_IGNORED_CHANNELS: 50,
  /** XP leaderboard entries per page */
  XP_LEADERBOARD_PAGE_SIZE: 10,
  /** Onboarding steps per guild */
  ONBOARDING_STEPS: 10,
  /** Discord AutoMod rules per guild */
  AUTOMOD_RULES: 6,
  /** AutoMod keywords per rule */
  AUTOMOD_KEYWORDS_PER_RULE: 100,
  /** AutoMod regex patterns per rule */
  AUTOMOD_REGEX_PER_RULE: 10,
  /** AutoMod regex pattern max length */
  AUTOMOD_REGEX_MAX_LENGTH: 75,
  /** Event templates per guild */
  EVENT_TEMPLATES: 25,
  /** Event reminders per event */
  EVENT_REMINDERS: 5,
  /** Ticket routing rules per guild */
  TICKET_ROUTING_RULES: 25,
  /** Status incidents to keep in history */
  STATUS_INCIDENTS: 100,
  /** CSV import max rows */
  IMPORT_CSV_MAX_ROWS: 10000,
  /** Analytics snapshots retention: 90 days */
  ANALYTICS_SNAPSHOT_DAYS: 90,
} as const;

export const JOIN_VELOCITY = {
  /** Maximum sliding window for join tracking: 10 minutes */
  MAX_WINDOW_MS: 10 * 60 * 1000,
} as const;

export const DEFAULT_TICKET_STATUSES: WorkflowStatus[] = [
  { id: 'open', label: 'Open', emoji: '\uD83D\uDCCB', color: '#5865F2' },
  {
    id: 'in-progress',
    label: 'In Progress',
    emoji: '\uD83D\uDD27',
    color: '#FFA500',
  },
  {
    id: 'awaiting-response',
    label: 'Awaiting Response',
    emoji: '\u23F3',
    color: '#FFD700',
  },
  { id: 'resolved', label: 'Resolved', emoji: '\u2705', color: '#00FF00' },
  { id: 'closed', label: 'Closed', emoji: '\uD83D\uDD12', color: '#808080' },
];

/** Status IDs that cannot be removed from a workflow */
export const REQUIRED_WORKFLOW_STATUSES = ['open', 'closed'];

export const DEFAULT_APPLICATION_STATUSES: {
  id: string;
  label: string;
  emoji: string;
  color: string;
}[] = [
  {
    id: 'submitted',
    label: 'Submitted',
    emoji: '\uD83D\uDCE5',
    color: '#5865F2',
  },
  {
    id: 'under-review',
    label: 'Under Review',
    emoji: '\uD83D\uDD0D',
    color: '#FFA500',
  },
  {
    id: 'interview',
    label: 'Interview',
    emoji: '\uD83C\uDF99\uFE0F',
    color: '#9B59B6',
  },
  {
    id: 'approved',
    label: 'Approved',
    emoji: '\u2705',
    color: '#00FF00',
  },
  {
    id: 'denied',
    label: 'Denied',
    emoji: '\u274C',
    color: '#FF0000',
  },
  {
    id: 'on-hold',
    label: 'On Hold',
    emoji: '\u23F8\uFE0F',
    color: '#FFD700',
  },
];

/** Application status IDs that cannot be removed from a workflow */
export const REQUIRED_APPLICATION_STATUSES = ['submitted', 'approved', 'denied'];

export const TIMEOUTS = {
  /** Modal await timeout: 5 minutes */
  MODAL: 300_000,
  /** Confirm/cancel button timeout: 30 seconds */
  CONFIRMATION: 30_000,
  /** General component collection timeout: 60 seconds */
  COMPONENT: 60_000,
  /** Long-lived dashboards/wizards: 5 minutes */
  DASHBOARD: 300_000,
} as const;

export const TEXT_LIMITS = {
  /** Short input field max length */
  SHORT_FIELD: 100,
  /** Paragraph input field max length */
  PARAGRAPH_FIELD: 4000,
  /** Starboard message content truncation */
  STARBOARD_CONTENT: 4096,
  /** Level-up message max length */
  LEVEL_UP_MESSAGE: 500,
  /** Onboarding welcome message max length */
  ONBOARDING_WELCOME: 2000,
  /** Event template description max length */
  EVENT_DESCRIPTION: 1000,
} as const;
