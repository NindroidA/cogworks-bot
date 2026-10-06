/**
 * Ticket health checks (design inventory §3.2): the panel with its category and
 * archive forum, ticket types, user restrictions and open tickets. Database plus
 * guild cache; deep mode adds the panel message and custom emoji (REST).
 * Applications have the same shape (§3.3), so the panel, archive, emoji and
 * custom-field helpers are exported for `applications.ts`.
 */
import type { ForumChannel, GuildBasedChannel, GuildTextBasedChannel } from 'discord.js';
import type { CustomInputField } from '../../../typeorm/entities/shared/CustomInputField';
import type { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { isValidSnowflake } from '../../api/helpers';
import { forumTagName } from '../../forumTagManager';
import { BUILTIN_TICKET_TYPE_IDS } from '../../ticket/builtinTypes';
import { type CheckContext, type HealthEntityName, rowsOf } from '../context';
import { defineCheck, type Emit, type FindingTarget } from '../define';
import { type ChannelKind, channelIsKind, missingPermissions, type PermissionName, resolveChannel } from '../refs';
import type { HealthCheck, HealthFinding, HealthSeverity, RepairClass } from '../types';

/**
 * Post a panel: View and Send. Neither panel sends an embed. Members click a posted
 * panel without the bot touching the channel, so these only matter for posting it again.
 */
const POST_PERMISSIONS: PermissionName[] = ['ViewChannel', 'SendMessages'];
/** Fetch and edit the posted panel (the application panel, when positions change). */
const EDIT_PERMISSIONS: PermissionName[] = ['ViewChannel', 'ReadMessageHistory'];
/** Create each private channel and write its permission overwrites. */
const CATEGORY_PERMISSIONS: PermissionName[] = ['ManageChannels', 'ManageRoles'];
/** Post transcripts as forum threads and re-upload attachments. */
const ARCHIVE_PERMISSIONS: PermissionName[] = [
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'EmbedLinks',
  'AttachFiles',
];
/** Create a missing type tag. Best effort: `ensureForumTag` logs a failure and the close goes on untagged. */
const TAG_PERMISSIONS: PermissionName[] = ['ManageChannels'];
/** Discord limits: per category, per forum, per modal, per select menu, per message (buttons), modal title. */
export const LIMITS = {
  categoryChannels: 50,
  forumTags: 20,
  modalFields: 5,
  selectOptions: 25,
  panelButtons: 25,
  modalTitle: 45,
};

/** True when the guild has a row of `entity`: the system counts as set up. */
export const hasRow =
  (entity: HealthEntityName) =>
  (ctx: CheckContext): boolean =>
    (rowsOf(ctx, entity) as unknown[]).length > 0;

/** For checks whose rows exist without setup (seeded types, leftover tickets): the config checks decide. */
export const notConfigSource = () => false;

type ChannelProblem = 'missing' | 'type' | 'permissions';
/** A deleted channel can be cleared like the delete event would; anything else needs the admin. */
const CHANNEL_REPAIR: Record<ChannelProblem, RepairClass> = { missing: 'auto', type: 'manual', permissions: 'manual' };

/**
 * A configured channel: `missing` only on proof, `type` when it is the wrong kind,
 * `permissions` when the bot lacks some (`missing`, also listed in `params`). `channel`
 * is set when it exists with the right kind.
 */
function inspectChannel(
  ctx: CheckContext,
  id: string,
  kinds: ChannelKind[],
  required: PermissionName[],
): {
  problem?: ChannelProblem;
  channel?: GuildBasedChannel;
  params: Record<string, string>;
  missing: PermissionName[];
} {
  const params = { channelId: id };
  const resolved = resolveChannel(ctx.guild, id);
  if (resolved.status !== 'ok')
    return { problem: resolved.status === 'missing' ? 'missing' : undefined, params, missing: [] };
  if (!channelIsKind(resolved.value, ...kinds)) return { problem: 'type', params, missing: [] };
  const missing = ctx.me ? missingPermissions(ctx.me, required, resolved.value) : [];
  if (missing.length === 0) return { channel: resolved.value, params, missing };
  const withList = { ...params, permissions: missing.join(', ') };
  return { problem: 'permissions', channel: resolved.value, params: withList, missing };
}

// ---------------------------------------------------------------------------
// Panel: channel and message, category, archive forum
// ---------------------------------------------------------------------------

export const PANEL_NAMES = [
  'panel_unset',
  'channel_missing',
  'channel_type',
  'channel_permissions',
  'message_missing',
  'category_unset',
  'category_missing',
  'category_type',
  'category_permissions',
  'category_full',
  'archive_unset',
] as const;

/** `TicketConfig` / `ApplicationConfig`. `''` means unset. */
interface PanelConfig {
  id: number;
  channelId: string;
  messageId: string;
  categoryId: string | null;
}

/**
 * The panel channel and its posted message. A blank `messageId` means the panel isn't
 * posted: the delete event clears it, and `/bot-setup` leaves it blank when the post
 * fails. `editsPanel`: the bot fetches and edits the posted panel later.
 */
async function checkPanelChannel(
  ctx: CheckContext,
  emit: Emit<(typeof PANEL_NAMES)[number]>,
  entity: string,
  config: PanelConfig,
  options: { editsPanel?: boolean },
): Promise<HealthFinding[]> {
  const out: HealthFinding[] = [];
  const at: FindingTarget = { entity, rowId: config.id, field: 'channelId', refId: config.channelId };
  const posted = Boolean(config.messageId);
  const required = options.editsPanel ? [...new Set([...POST_PERMISSIONS, ...EDIT_PERMISSIONS])] : POST_PERMISSIONS;
  const panel = inspectChannel(ctx, config.channelId, ['text', 'news'], required);
  if (panel.problem === 'permissions') {
    // A posted panel keeps working: members click it without the bot touching the
    // channel. It only goes stale when the bot can't fetch it to edit it.
    const stale = options.editsPanel && EDIT_PERMISSIONS.some(name => panel.missing.includes(name));
    const severity: HealthSeverity = !posted || stale ? 'degraded' : 'cosmetic';
    out.push(emit('channel_permissions', severity, 'manual', { ...at, params: panel.params }));
  } else if (panel.problem)
    out.push(emit(`channel_${panel.problem}`, 'block', CHANNEL_REPAIR[panel.problem], { ...at, params: panel.params }));
  // The panel is the only way in: without it nobody can open one (same effect as a deleted channel).
  const notPosted = (staleId?: string) => {
    const target: FindingTarget = {
      entity,
      rowId: config.id,
      field: 'messageId',
      params: { channelId: config.channelId },
    };
    return emit('message_missing', 'block', 'confirm', staleId ? { ...target, refId: staleId } : target);
  };
  // A deleted channel or one of the wrong kind is reported above; this is the panel itself.
  if (!posted && panel.problem !== 'missing' && panel.problem !== 'type') out.push(notPosted());
  else if (posted && panel.channel && ctx.deep && isValidSnowflake(config.messageId)) {
    // A stored id can still point at a message deleted while the bot was offline.
    const channel = panel.channel as GuildTextBasedChannel;
    const fetched = await ctx.rest.fetch(`${entity}.messageId`, () =>
      channel.messages.fetch({ message: config.messageId, force: true }),
    );
    if (fetched.status === 'missing') out.push(notPosted(config.messageId));
  }
  return out;
}

/**
 * A config row means setup started. A blank `channelId` is a panel nobody can click:
 * the delete event blanks it (with `messageId`), and `/ticket-setup` or
 * `/application-setup` with only a category never sets it. The category and archive
 * are checked either way.
 */
export async function checkPanel(
  ctx: CheckContext,
  emit: Emit<(typeof PANEL_NAMES)[number]>,
  entity: string,
  config: PanelConfig | undefined,
  archiveChannelId: string | undefined,
  options: { editsPanel?: boolean } = {},
): Promise<HealthFinding[]> {
  if (!config) return [];
  const out: HealthFinding[] = config.channelId
    ? await checkPanelChannel(ctx, emit, entity, config, options)
    : [emit('panel_unset', 'block', 'manual', { entity, rowId: config.id, field: 'channelId' })];

  const categoryAt: FindingTarget = { entity, rowId: config.id, field: 'categoryId' };
  if (!config.categoryId) out.push(emit('category_unset', 'block', 'manual', categoryAt));
  else {
    const target = { ...categoryAt, refId: config.categoryId };
    const category = inspectChannel(ctx, config.categoryId, ['category'], CATEGORY_PERMISSIONS);
    if (category.problem) {
      const repair = CHANNEL_REPAIR[category.problem];
      out.push(emit(`category_${category.problem}`, 'block', repair, { ...target, params: category.params }));
    }
    let children = 0;
    for (const channel of ctx.guild.channels.cache.values()) if (channel.parentId === config.categoryId) children++;
    if (category.channel && children >= LIMITS.categoryChannels)
      out.push(
        emit('category_full', 'block', 'manual', { ...target, params: { ...category.params, count: children } }),
      );
  }

  // Closing archives the transcript first, so without the forum nothing can be closed.
  // The delete event blanks a deleted forum's `channelId` and keeps the row, so blank counts as unset.
  if (!archiveChannelId) out.push(emit('archive_unset', 'block', 'manual', { entity, rowId: config.id }));
  return out;
}

export const ARCHIVE_NAMES = [
  'channel_missing',
  'channel_type',
  'channel_permissions',
  'tag_permissions',
  'tags_full',
] as const;

/** `tagNames`: the tags closes will ask for (matched case-insensitively, as `ensureForumTag` does). */
export function checkArchiveForum(
  ctx: CheckContext,
  emit: Emit<(typeof ARCHIVE_NAMES)[number]>,
  entity: string,
  archive: { id: number; channelId: string } | undefined,
  tagNames: readonly string[],
): HealthFinding[] {
  if (!archive?.channelId) return [];
  const out: HealthFinding[] = [];
  const at: FindingTarget = { entity, rowId: archive.id, field: 'channelId', refId: archive.channelId };
  const forum = inspectChannel(ctx, archive.channelId, ['forum'], ARCHIVE_PERMISSIONS);
  if (forum.problem)
    out.push(emit(`channel_${forum.problem}`, 'block', CHANNEL_REPAIR[forum.problem], { ...at, params: forum.params }));
  // Closes still work without it; tags that don't exist yet just aren't created.
  if (forum.channel && ctx.me && missingPermissions(ctx.me, TAG_PERMISSIONS, forum.channel).length > 0)
    out.push(emit('tag_permissions', 'degraded', 'manual', { ...at, params: { channelId: archive.channelId } }));
  // A full forum only hurts when a close needs a tag it doesn't have yet.
  const tags = (forum.channel as ForumChannel | undefined)?.availableTags ?? [];
  const existing = new Set(tags.map(tag => tag.name.toLowerCase()));
  const untagged = [...new Set(tagNames)].filter(name => !existing.has(forumTagName(name).toLowerCase()));
  if (tags.length >= LIMITS.forumTags && untagged.length > 0)
    out.push(
      emit('tags_full', 'degraded', 'manual', { ...at, params: { ...forum.params, names: untagged.join(', ') } }),
    );
  return out;
}

// ---------------------------------------------------------------------------
// Ticket types and positions: emoji and modal fields
// ---------------------------------------------------------------------------

export const EMOJI_NAMES = ['emoji_invalid', 'emoji_missing'] as const;
const CUSTOM_EMOJI = /^(?:<a?:\w{2,32}:(\d{17,20})>|(\d{17,20}))$/;
// Built at runtime: the `v` flag (needed for \p{RGI_Emoji}) is newer than the compile target.
const RGI_EMOJI_SOURCE = '^\\p{RGI_Emoji}$';
const UNICODE_EMOJI = new RegExp(RGI_EMOJI_SOURCE, 'v');
const VARIATION_SELECTOR_16 = String.fromCodePoint(0xfe0f);

/** One unicode emoji. Discord also takes the text form without U+FE0F (❤ for ❤️). */
const isUnicodeEmoji = (value: string) =>
  UNICODE_EMOJI.test(value) || UNICODE_EMOJI.test(value + VARIATION_SELECTOR_16);

/**
 * Checks a stored emoji (select option or button): a custom emoji (`<a:name:id>` or its
 * bare id) or one unicode emoji. `severity` rates one Discord rejects.
 *
 * Whether a custom emoji still exists is a REST call (the emoji cache goes stale without
 * the GuildExpressions intent), so only deep mode checks it, with one listing per check.
 * Discord also takes the bot's own (application) emoji and emoji from other servers the
 * bot is in, so one missing from this server isn't proof it's broken: it is only
 * reported when it's in neither, as `cosmetic` with a `manual` repair. A failed listing
 * reports nothing.
 */
export function emojiChecker(ctx: CheckContext) {
  const listing = (label: string, call: () => Promise<Map<string, unknown>>) =>
    ctx.rest.fetch(label, call).then(outcome => (outcome.status === 'ok' ? new Set(outcome.value.keys()) : null));
  let onServer: Promise<Set<string> | null> | undefined;
  let own: Promise<Set<string> | null> | undefined;
  /** True when the bot can use the emoji, false when it found it nowhere, null when a listing failed. */
  const usable = async (id: string): Promise<boolean | null> => {
    onServer ??= listing('guild emojis', () => ctx.guild.emojis.fetch());
    const server = await onServer;
    if (!server) return null;
    if (server.has(id)) return true;
    const client = ctx.guild.client;
    // Other servers come from the cache: a stale entry can only hide a finding.
    for (const guild of client?.guilds.cache.values() ?? [])
      if (guild.id !== ctx.guild.id && guild.emojis.cache.has(id)) return true;
    const application = client?.application;
    if (!application) return false;
    own ??= listing('application emojis', () => application.emojis.fetch());
    const bot = await own;
    return bot ? bot.has(id) : null;
  };
  return async (
    emoji: string | null | undefined,
    emit: Emit<(typeof EMOJI_NAMES)[number]>,
    at: FindingTarget,
    severity: HealthSeverity,
  ): Promise<HealthFinding[]> => {
    if (!emoji) return [];
    const target: FindingTarget = { ...at, field: 'emoji', params: { ...at.params, emoji } };
    const match = CUSTOM_EMOJI.exec(emoji);
    if (!match) return isUnicodeEmoji(emoji) ? [] : [emit('emoji_invalid', severity, 'confirm', target)];
    if (!ctx.deep) return [];
    const id = match[1] ?? match[2];
    return (await usable(id)) === false ? [emit('emoji_missing', 'cosmetic', 'manual', { ...target, refId: id })] : [];
  };
}

export const FIELD_NAMES = ['too_many_fields', 'field_id', 'field_label', 'field_placeholder', 'field_length'] as const;

/** The modal only applies truthy limits (`if (field.minLength)`): min 0–4000, max 1–4000, min ≤ max. */
function lengthsValid(min: unknown, max: unknown): boolean {
  const inRange = (value: unknown, low: number) =>
    !value || (Number.isInteger(value) && (value as number) >= low && (value as number) <= 4000);
  if (!inRange(min, 0) || !inRange(max, 1)) return false;
  return !min || !max || (min as number) <= (max as number);
}

/**
 * Modal inputs, checked as the builders and Discord check them when the modal opens: any
 * violation fails every open. `truncatesAt`: the modal shows only the first N questions
 * (tickets), so extra ones are never asked rather than breaking the form, and only the
 * shown ones are checked.
 */
export function checkCustomFields(
  emit: Emit<(typeof FIELD_NAMES)[number]>,
  fields: unknown,
  at: FindingTarget,
  severity: HealthSeverity,
  options: { truncatesAt?: number } = {},
): HealthFinding[] {
  if (!Array.isArray(fields)) return [];
  const out: HealthFinding[] = [];
  const target: FindingTarget = { ...at, field: 'customFields' };
  const { truncatesAt } = options;
  if (fields.length > (truncatesAt ?? LIMITS.modalFields)) {
    // The form still opens; the questions past the cut are never asked.
    const overflow: HealthSeverity = truncatesAt !== undefined && severity === 'block' ? 'degraded' : severity;
    const params = { ...at.params, count: fields.length };
    out.push(emit('too_many_fields', overflow, 'confirm', { ...target, params }));
  }
  const seen = new Set<string>();
  fields.slice(0, truncatesAt).forEach((raw, index) => {
    const field = (raw ?? {}) as Partial<CustomInputField>;
    const params = { ...at.params, input: index + 1, label: String(field.label ?? '') };
    const flag = (name: (typeof FIELD_NAMES)[number]) =>
      out.push(emit(name, severity, 'confirm', { ...target, params }));
    const id = field.id;
    if (typeof id !== 'string' || id.length < 1 || id.length > 100 || seen.has(id)) flag('field_id');
    if (typeof id === 'string') seen.add(id);
    if (typeof field.label !== 'string' || field.label.length < 1 || field.label.length > 45) flag('field_label');
    if (field.placeholder && String(field.placeholder).length > 100) flag('field_placeholder');
    if (!lengthsValid(field.minLength, field.maxLength)) flag('field_length');
  });
  return out;
}

// ---------------------------------------------------------------------------
// Ticket checks
// ---------------------------------------------------------------------------

/** Type ids a restriction may name (seeded types reuse the builtin ids). */
const knownTypeIds = (types: CustomTicketType[]) =>
  new Set<string>([...BUILTIN_TICKET_TYPE_IDS, ...types.map(type => type.typeId)]);

const panel = defineCheck(
  {
    id: 'ticket.panel',
    system: 'ticket',
    entities: ['TicketConfig', 'ArchivedTicketConfig'],
    names: PANEL_NAMES,
    isConfigured: hasRow('TicketConfig'),
  },
  (ctx, emit) => {
    const archiveId = rowsOf(ctx, 'ArchivedTicketConfig')[0]?.channelId;
    return checkPanel(ctx, emit, 'TicketConfig', rowsOf(ctx, 'TicketConfig')[0], archiveId);
  },
);

const archive = defineCheck(
  {
    id: 'ticket.archive',
    system: 'ticket',
    entities: ['ArchivedTicketConfig', 'CustomTicketType'],
    names: ARCHIVE_NAMES,
    isConfigured: hasRow('ArchivedTicketConfig'),
  },
  (ctx, emit) => {
    const tagNames = rowsOf(ctx, 'CustomTicketType')
      .filter(type => type.isActive)
      .map(type => type.displayName);
    return checkArchiveForum(ctx, emit, 'ArchivedTicketConfig', rowsOf(ctx, 'ArchivedTicketConfig')[0], tagNames);
  },
);

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const types = defineCheck(
  {
    id: 'ticket.type',
    system: 'ticket',
    entities: ['CustomTicketType', 'TicketConfig'],
    names: [
      'too_many_active',
      'none_active',
      'multiple_defaults',
      'color_invalid',
      'title_too_long',
      ...EMOJI_NAMES,
      ...FIELD_NAMES,
    ],
    isConfigured: hasRow('TicketConfig'),
  },
  async (ctx, emit) => {
    // Lowest sortOrder first, as the panel lists them (and the default a repair keeps).
    const rows = [...rowsOf(ctx, 'CustomTicketType')].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const active = rows.filter(type => type.isActive);
    const out: HealthFinding[] = [];
    const all: FindingTarget = { entity: 'CustomTicketType', field: 'isActive' };
    // The type picker is one select menu. When it can't be sent (over 25 options, or an
    // emoji Discord rejects), createTicketButton falls back to the 5 built-in type buttons.
    if (active.length > LIMITS.selectOptions)
      out.push(emit('too_many_active', 'degraded', 'manual', { ...all, params: { count: active.length } }));
    // With no active type the menu offers only "No ticket types available", so nothing opens.
    if (active.length === 0 && rowsOf(ctx, 'TicketConfig')[0]?.channelId)
      out.push(emit('none_active', 'block', 'manual', all));
    const defaults = rows.filter(type => type.isDefault);
    for (const extra of defaults.slice(1)) {
      const params = { typeId: extra.typeId, keptTypeId: defaults[0].typeId };
      out.push(emit('multiple_defaults', 'cosmetic', 'auto', { entity: 'CustomTicketType', rowId: extra.id, params }));
    }

    const checkEmoji = emojiChecker(ctx);
    for (const type of rows) {
      // An inactive type is never offered, so its problems wait until someone turns it on.
      const severity: HealthSeverity = type.isActive ? 'block' : 'cosmetic';
      const params = { typeId: type.typeId, name: type.displayName };
      const at: FindingTarget = { entity: 'CustomTicketType', rowId: type.id, params };
      if (!HEX_COLOR.test(String(type.embedColor))) {
        const target = { ...at, field: 'embedColor', params: { ...params, color: String(type.embedColor) } };
        out.push(emit('color_invalid', 'cosmetic', 'auto', target));
      }
      // The ticket modal's title, built untruncated: the builder rejects it on every open.
      const title = `${type.emoji || '🎫'} ${type.displayName}`;
      if (title.length > LIMITS.modalTitle) {
        const target = { ...at, field: 'displayName', params: { ...params, length: title.length } };
        out.push(emit('title_too_long', severity, 'manual', target));
      }
      // A rejected emoji only costs the type menu (see the fallback above).
      const menuSeverity: HealthSeverity = type.isActive ? 'degraded' : 'cosmetic';
      out.push(...(await checkEmoji(type.emoji, emit, at, menuSeverity)));
      // buildCustomTicketModal shows the first 5 questions and drops the rest.
      out.push(...checkCustomFields(emit, type.customFields, at, severity, { truncatesAt: LIMITS.modalFields }));
    }
    return out;
  },
);

const restrictions = defineCheck(
  {
    id: 'ticket.restriction',
    system: 'ticket',
    entities: ['UserTicketRestriction', 'CustomTicketType'],
    names: ['unknown_type'],
    isConfigured: notConfigSource,
  },
  (ctx, emit) => {
    const typeIds = knownTypeIds(rowsOf(ctx, 'CustomTicketType'));
    return rowsOf(ctx, 'UserTicketRestriction')
      .filter(row => !typeIds.has(row.typeId))
      .map(row => {
        const params = { typeId: row.typeId, userId: row.userId };
        // Not lossless: the row keeps its reason, and re-adding a type with that id revives it.
        return emit('unknown_type', 'cosmetic', 'confirm', { entity: 'UserTicketRestriction', rowId: row.id, params });
      });
  },
);

/** A ticket row is saved before its channel is created; one still without a channel after this long failed. */
export const FAILED_CREATION_MS = 10 * 60 * 1000;

const openTickets = defineCheck(
  {
    id: 'ticket.open',
    system: 'ticket',
    entities: ['Ticket'],
    names: ['channel_missing', 'creation_failed'],
    isConfigured: notConfigSource,
  },
  (ctx, emit) => {
    const out: HealthFinding[] = [];
    const now = Date.now();
    // Each one counts toward least-load routing and SLA scans until it is closed.
    for (const ticket of rowsOf(ctx, 'Ticket')) {
      if (ticket.status === 'closed') continue;
      const at: FindingTarget = {
        entity: 'Ticket',
        rowId: ticket.id,
        field: 'channelId',
        params: { ticketId: ticket.id, channelId: ticket.channelId ?? '' },
      };
      if (ticket.channelId) {
        if (resolveChannel(ctx.guild, ticket.channelId).status === 'missing')
          out.push(emit('channel_missing', 'degraded', 'confirm', { ...at, refId: ticket.channelId }));
      } else if (ticket.status === 'created' && now - new Date(ticket.lastActivityAt).getTime() > FAILED_CREATION_MS) {
        out.push(emit('creation_failed', 'degraded', 'confirm', at));
      }
    }
    return out;
  },
);

export const TICKET_CHECKS: readonly HealthCheck[] = [panel, archive, types, restrictions, openTickets];
