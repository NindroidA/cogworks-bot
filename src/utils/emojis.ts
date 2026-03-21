/**
 * Centralized emoji system for all Discord messages and embeds
 * Uses 'as const' pattern for type safety and tree-shaking
 * Organized by category for easy maintenance and scaling
 *
 * @example
 * ```typescript
 * import { Emoji, E, em } from '../utils';
 *
 * // Raw emoji access
 * const text = `${E.ok} Operation complete`;
 *
 * // Category access
 * const status = Emoji.status.success; // "✅"
 *
 * // Wrapper functions
 * const message = em.success(lang.ticket.created);
 * ```
 */

export const Emoji = {
  // Status indicators
  status: {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    pending: '⏳',
    loading: '🔄',
    active: '🟢',
    inactive: '🔴',
    neutral: '⚪',
  },

  // Action/UI emojis
  action: {
    add: '➕',
    remove: '➖',
    delete: '🗑️',
    edit: '✏️',
    save: '💾',
    cancel: '❎',
    confirm: '☑️',
    done: '✅',
    refresh: '🔄',
    search: '🔍',
    preview: '👁️',
    reorder: '🔀',
    link: '🔗',
    skip: '⏭️',
  },

  // Time-related emojis
  time: {
    clock: '⏰',
    timer: '⏱️',
    calendar: '📅',
    relative: '🕐',
  },

  // Moderation emojis
  moderation: {
    ban: '🔨',
    kick: '👢',
    timeout: '⏸️',
    warn: '⚠️',
    restrict: '🚫',
    whitelist: '🛡️',
    alert: '🚨',
  },

  // Feature-specific emojis
  feature: {
    ticket: '🎫',
    application: '📝',
    announcement: '📢',
    baitChannel: '🪤',
    role: '🎭',
    user: '👤',
    users: '👥',
    settings: '⚙️',
    config: '🔧',
    memory: '📝',
  },

  // Content/data emojis
  content: {
    message: '💬',
    attachment: '📎',
    file: '📄',
    folder: '📁',
    category: '📂',
    archive: '🗃️',
    export: '📤',
    import: '📥',
    list: '📋',
  },

  // Statistics/metrics emojis
  stats: {
    chart: '📊',
    score: '📈',
    count: '🔢',
    version: '📌',
    target: '🎯',
  },

  // System/console emojis
  system: {
    dev: '🔩',
    prod: '🚀',
    ready: '🖥️',
    error: '💀',
    shutdown: '🛑',
    bot: '🤖',
    id: '🆔',
    new: '🆕',
  },

  // Decorative/brand emojis
  decorative: {
    wrench: '🔧',
    sparkle: '✨',
    party: '🎉',
    wave: '👋',
    pin: '📍',
    tip: '💡',
    book: '📖',
    shield: '🛡️',
    gaming: '🎮',
    exclaim: '‼️',
  },

  // Legacy ticket types
  ticketTypes: {
    ageVerify: '🔞',
    banAppeal: '⚖️',
    playerReport: '📢',
    bugReport: '🐛',
    other: '❓',
  },
} as const;

/**
 * Shorthand emoji access for the most commonly used emojis
 * Prefer this for inline usage: `${E.ok} Success!`
 */
export const E = {
  // Status
  ok: Emoji.status.success,
  success: Emoji.status.success,
  error: Emoji.status.error,
  fail: Emoji.status.error,
  warn: Emoji.status.warning,
  warning: Emoji.status.warning,
  info: Emoji.status.info,
  pending: Emoji.status.pending,
  loading: Emoji.status.loading,

  // States
  active: Emoji.status.active,
  inactive: Emoji.status.inactive,
  on: Emoji.status.active,
  off: Emoji.status.inactive,

  // Actions
  add: Emoji.action.add,
  remove: Emoji.action.remove,
  delete: Emoji.action.delete,
  edit: Emoji.action.edit,
  cancel: Emoji.action.cancel,
  skip: Emoji.action.skip,
  preview: Emoji.action.preview,
  reorder: Emoji.action.reorder,
  search: Emoji.action.search,

  // Time
  timer: Emoji.time.timer,
  clock: Emoji.time.clock,
  calendar: Emoji.time.calendar,

  // Moderation
  ban: Emoji.moderation.ban,
  kick: Emoji.moderation.kick,
  restrict: Emoji.moderation.restrict,
  alert: Emoji.moderation.alert,

  // Features
  ticket: Emoji.feature.ticket,
  app: Emoji.feature.application,
  announce: Emoji.feature.announcement,
  bait: Emoji.feature.baitChannel,
  user: Emoji.feature.user,
  users: Emoji.feature.users,
  role: Emoji.feature.role,
  config: Emoji.feature.config,
  settings: Emoji.feature.settings,
  memory: Emoji.feature.memory,

  // Content
  msg: Emoji.content.message,
  file: Emoji.content.attachment,
  archive: Emoji.content.archive,
  folder: Emoji.content.category,
  list: Emoji.content.list,

  // Stats
  chart: Emoji.stats.chart,
  version: Emoji.stats.version,
  target: Emoji.stats.target,

  // System
  dev: Emoji.system.dev,
  prod: Emoji.system.prod,
  ready: Emoji.system.ready,
  shutdown: Emoji.system.shutdown,
  bot: Emoji.system.bot,
  id: Emoji.system.id,
  new: Emoji.system.new,

  // Decorative
  tip: Emoji.decorative.tip,
  party: Emoji.decorative.party,
  pin: Emoji.decorative.pin,
  gaming: Emoji.decorative.gaming,
  wrench: Emoji.decorative.wrench,
  exclaim: Emoji.decorative.exclaim,
} as const;

/**
 * Emoji wrapper functions that prepend emojis to strings
 * Useful for adding consistent emoji prefixes to lang strings
 *
 * @example
 * ```typescript
 * em.success(lang.ticket.created)  // "✅ Your ticket has been created"
 * em.error(lang.errors.generic)    // "❌ An error occurred"
 * ```
 */
export const em = {
  // Status wrappers
  success: (text: string) => `${Emoji.status.success} ${text}`,
  error: (text: string) => `${Emoji.status.error} ${text}`,
  warning: (text: string) => `${Emoji.status.warning} ${text}`,
  info: (text: string) => `${Emoji.status.info} ${text}`,
  pending: (text: string) => `${Emoji.status.pending} ${text}`,

  // State wrappers
  active: (text: string) => `${Emoji.status.active} ${text}`,
  inactive: (text: string) => `${Emoji.status.inactive} ${text}`,

  // Time wrappers
  timer: (text: string) => `${Emoji.time.timer} ${text}`,
  calendar: (text: string) => `${Emoji.time.calendar} ${text}`,

  // Moderation wrappers
  ban: (text: string) => `${Emoji.moderation.ban} ${text}`,
  kick: (text: string) => `${Emoji.moderation.kick} ${text}`,
  restrict: (text: string) => `${Emoji.moderation.restrict} ${text}`,
  alert: (text: string) => `${Emoji.moderation.alert} ${text}`,

  // Feature wrappers
  ticket: (text: string) => `${Emoji.feature.ticket} ${text}`,
  application: (text: string) => `${Emoji.feature.application} ${text}`,
  announcement: (text: string) => `${Emoji.feature.announcement} ${text}`,

  // Generic wrapper (use any emoji)
  with: (emoji: string, text: string) => `${emoji} ${text}`,
};

/**
 * Creates an emoji-prefixed formatted string
 * Use when you need both emoji prefix AND template formatting
 *
 * @example
 * ```typescript
 * const formatted = emLANGF(E.error, lang.errors.rateLimit, "5");
 * // "❌ You're using this command too quickly. Please try again in 5 minutes."
 * ```
 */
export function emLANGF(emoji: string, template: string, ...args: (string | number)[]): string {
  const formatted = template.replace(/\{(\d+)\}/g, (match, index) => {
    const argIndex = parseInt(index, 10);
    return args[argIndex] !== undefined ? String(args[argIndex]) : match;
  });
  return `${emoji} ${formatted}`;
}

export type EmojiCategory = keyof typeof Emoji;
export type StatusEmoji = keyof typeof Emoji.status;
export type ActionEmoji = keyof typeof Emoji.action;
export type TimeEmoji = keyof typeof Emoji.time;
export type ModerationEmoji = keyof typeof Emoji.moderation;
export type FeatureEmoji = keyof typeof Emoji.feature;
export type ContentEmoji = keyof typeof Emoji.content;
export type StatsEmoji = keyof typeof Emoji.stats;
export type SystemEmoji = keyof typeof Emoji.system;
export type DecorativeEmoji = keyof typeof Emoji.decorative;
export type TicketTypeEmoji = keyof typeof Emoji.ticketTypes;

export default Emoji;
