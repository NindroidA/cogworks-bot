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
import { BUILTIN_TICKET_TYPE_IDS } from '../../ticket/builtinTypes';
import { type CheckContext, type HealthEntityName, rowsOf } from '../context';
import { defineCheck, type Emit, type FindingTarget } from '../define';
import { type ChannelKind, channelIsKind, missingPermissions, type PermissionName, resolveChannel } from '../refs';
import type { HealthCheck, HealthFinding, HealthSeverity, RepairClass } from '../types';

/** View, Send, Embed Links, Read History: post (and edit) a message in a channel. */
const SEND_PERMISSIONS: PermissionName[] = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'];
/** Create each private channel and write its permission overwrites. */
const CATEGORY_PERMISSIONS: PermissionName[] = ['ManageChannels', 'ManageRoles'];
/** Post transcripts as forum threads, re-upload attachments, and create type tags. */
const ARCHIVE_PERMISSIONS: PermissionName[] = [
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'EmbedLinks',
  'AttachFiles',
  'ManageChannels',
];
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
 * `permissions` when the bot lacks some (listed in `params`). `channel` is set when it exists with the right kind.
 */
function inspectChannel(
  ctx: CheckContext,
  id: string,
  kinds: ChannelKind[],
  required: PermissionName[],
): { problem?: ChannelProblem; channel?: GuildBasedChannel; params: Record<string, string> } {
  const params = { channelId: id };
  const resolved = resolveChannel(ctx.guild, id);
  if (resolved.status !== 'ok') return { problem: resolved.status === 'missing' ? 'missing' : undefined, params };
  if (!channelIsKind(resolved.value, ...kinds)) return { problem: 'type', params };
  const missing = ctx.me ? missingPermissions(ctx.me, required, resolved.value) : [];
  if (missing.length === 0) return { channel: resolved.value, params };
  return { problem: 'permissions', channel: resolved.value, params: { ...params, permissions: missing.join(', ') } };
}

// ---------------------------------------------------------------------------
// Panel: channel (+ message in deep mode), category, archive forum
// ---------------------------------------------------------------------------

export const PANEL_NAMES = [
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

/** Only a posted panel lets members open anything, so a config without one reports nothing. */
export async function checkPanel(
  ctx: CheckContext,
  emit: Emit<(typeof PANEL_NAMES)[number]>,
  entity: string,
  config: PanelConfig | undefined,
  archiveChannelId: string | undefined,
): Promise<HealthFinding[]> {
  if (!config?.channelId) return [];
  const out: HealthFinding[] = [];
  const at: FindingTarget = { entity, rowId: config.id, field: 'channelId', refId: config.channelId };
  const panel = inspectChannel(ctx, config.channelId, ['text', 'news'], SEND_PERMISSIONS);
  if (panel.problem)
    out.push(emit(`channel_${panel.problem}`, 'block', CHANNEL_REPAIR[panel.problem], { ...at, params: panel.params }));
  if (panel.channel && ctx.deep && isValidSnowflake(config.messageId)) {
    const channel = panel.channel as GuildTextBasedChannel;
    const fetched = await ctx.rest.fetch(`${entity}.messageId`, () =>
      channel.messages.fetch({ message: config.messageId, force: true }),
    );
    if (fetched.status === 'missing')
      out.push(
        emit('message_missing', 'block', 'confirm', {
          ...at,
          field: 'messageId',
          refId: config.messageId,
          params: panel.params,
        }),
      );
  }

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
  if (!archiveChannelId) out.push(emit('archive_unset', 'block', 'manual', { entity, rowId: config.id }));
  return out;
}

export const ARCHIVE_NAMES = ['channel_missing', 'channel_type', 'channel_permissions', 'tags_full'] as const;

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
  // A full forum only hurts when a close needs a tag it doesn't have yet.
  const tags = (forum.channel as ForumChannel | undefined)?.availableTags ?? [];
  const existing = new Set(tags.map(tag => tag.name.toLowerCase()));
  const untagged = [...new Set(tagNames)].filter(name => !existing.has(name.toLowerCase()));
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
 * bare id) or one unicode emoji. Whether a custom emoji still exists is a REST call
 * (the emoji cache goes stale without the GuildExpressions intent), so only deep mode
 * checks it, with one listing per check run.
 */
export function emojiChecker(ctx: CheckContext) {
  let known: Promise<Set<string> | null> | undefined;
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
    known ??= ctx.rest
      .fetch('guild emojis', () => ctx.guild.emojis.fetch())
      .then(outcome => (outcome.status === 'ok' ? new Set(outcome.value.keys()) : null));
    const ids = await known;
    const id = match[1] ?? match[2];
    return ids && !ids.has(id) ? [emit('emoji_missing', severity, 'confirm', { ...target, refId: id })] : [];
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

/** Modal inputs, checked as the builders and Discord check them when the modal opens: any violation fails every open. */
export function checkCustomFields(
  emit: Emit<(typeof FIELD_NAMES)[number]>,
  fields: unknown,
  at: FindingTarget,
  severity: HealthSeverity,
): HealthFinding[] {
  if (!Array.isArray(fields)) return [];
  const out: HealthFinding[] = [];
  const target: FindingTarget = { ...at, field: 'customFields' };
  if (fields.length > LIMITS.modalFields)
    out.push(
      emit('too_many_fields', severity, 'confirm', { ...target, params: { ...at.params, count: fields.length } }),
    );
  const seen = new Set<string>();
  fields.forEach((raw, index) => {
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
    // The type picker is one select menu.
    if (active.length > LIMITS.selectOptions)
      out.push(emit('too_many_active', 'block', 'manual', { ...all, params: { count: active.length } }));
    if (active.length === 0 && rowsOf(ctx, 'TicketConfig')[0]?.channelId)
      out.push(emit('none_active', 'degraded', 'manual', all));
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
      out.push(...(await checkEmoji(type.emoji, emit, at, severity)));
      out.push(...checkCustomFields(emit, type.customFields, at, severity));
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
        return emit('unknown_type', 'cosmetic', 'auto', { entity: 'UserTicketRestriction', rowId: row.id, params });
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
