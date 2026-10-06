/**
 * Reaction-role health checks (design inventory §3.6): each menu's channel,
 * message (deep mode), mode and option count, and each option's role and
 * emoji. Options load with their menu: they have no guildId column, so an
 * option whose menu is gone can't be tied to a guild and is not checked here.
 */
import { type CheckContext, rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { missingPermissions, type PermissionName } from '../refs';
import type { HealthCheck, HealthFinding } from '../types';
import {
  channelParams,
  channelProblem,
  channelReadable,
  channelSeverity,
  MESSAGE_CHANNEL,
  messageStatus,
  REACTION_CRITICAL,
  roleProblem,
  UNICODE_EMOJI,
} from './refHelpers';

const MENU_PERMS: PermissionName[] = ['ViewChannel', 'AddReactions', 'ReadMessageHistory'];
/** Unique mode takes the member's previous reaction off, which needs Manage Messages. */
const UNIQUE_PERMS: PermissionName[] = [...MENU_PERMS, 'ManageMessages'];
/** Discord allows at most 20 different reactions on one message. */
const MAX_REACTIONS = 20;
const MODES = new Set(['normal', 'unique', 'lock']);
const CUSTOM_EMOJI = /^(?:a?:)?(\w{2,32}):(\d{17,20})$/;

const isConfigured = (ctx: CheckContext) => rowsOf(ctx, 'ReactionRoleMenu').length > 0;

/**
 * The reaction lookup's identity for a stored option emoji (`utils/reactionRole/optionEmoji.ts`
 * once #53 lands): a custom emoji by id in any spelling (`<:x:id>`, `<a:x:id>`, `x:id`), a
 * unicode emoji by itself. Null when it is neither.
 */
export function optionEmojiKey(stored: string): string | null {
  const trimmed = stored.trim();
  const inner = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
  const custom = CUSTOM_EMOJI.exec(inner);
  if (custom) return custom[2];
  return UNICODE_EMOJI.test(trimmed) ? trimmed : null;
}

const menus = defineCheck(
  {
    id: 'reactionRole.menu',
    system: 'reactionRole',
    entities: ['ReactionRoleMenu'],
    isConfigured,
    names: [
      'channel_missing',
      'channel_wrong_type',
      'channel_permissions',
      'message_missing',
      'mode',
      'no_options',
      'too_many_options',
      'manage_roles',
    ],
  },
  async (ctx, emit) => {
    const rows = rowsOf(ctx, 'ReactionRoleMenu');
    const out: HealthFinding[] = [];
    if (rows.length > 0 && ctx.me && missingPermissions(ctx.me, ['ManageRoles']).length > 0)
      out.push(emit('manage_roles', 'block', 'manual', { entity: 'ReactionRoleMenu' }));
    for (const menu of rows) {
      const at: FindingTarget = { entity: 'ReactionRoleMenu', rowId: menu.id, params: { name: menu.name } };
      const perms = menu.mode === 'unique' ? UNIQUE_PERMS : MENU_PERMS;
      const channel = channelProblem(ctx, menu.channelId, MESSAGE_CHANNEL, perms);
      if (channel) {
        // The channelDelete cleaner deletes the menu with its options, so confirm it.
        const params = { ...at.params, ...channelParams(menu.channelId, channel) };
        const target = { ...at, field: 'channelId', refId: menu.channelId, params };
        const repair = channel.problem === 'missing' ? 'confirm' : 'manual';
        out.push(emit(`channel_${channel.problem}`, channelSeverity(channel, REACTION_CRITICAL), repair, target));
      }
      const readable = channelReadable(channel, REACTION_CRITICAL);
      const message = readable
        ? await messageStatus(ctx, 'reactionRole.message', menu.channelId, menu.messageId)
        : null;
      if (message === 'missing') {
        const params = { ...at.params, channelId: menu.channelId };
        out.push(
          emit('message_missing', 'block', 'confirm', { ...at, field: 'messageId', refId: menu.messageId, params }),
        );
      }
      // An unknown mode already behaves as `normal`, so setting it loses nothing.
      const mode = { ...at, field: 'mode', params: { ...at.params, mode: String(menu.mode) } };
      if (!MODES.has(menu.mode)) out.push(emit('mode', 'cosmetic', 'auto', mode));
      const count = menu.options?.length ?? 0;
      const tooMany = { ...at, params: { ...at.params, count, max: MAX_REACTIONS } };
      if (count === 0) out.push(emit('no_options', 'degraded', 'manual', at));
      else if (count > MAX_REACTIONS) out.push(emit('too_many_options', 'degraded', 'manual', tooMany));
    }
    return out;
  },
);

const options = defineCheck(
  {
    id: 'reactionRole.option',
    system: 'reactionRole',
    entities: ['ReactionRoleMenu'],
    isConfigured,
    names: ['role_missing', 'role_everyone', 'role_managed', 'role_too_high', 'emoji_invalid', 'emoji_duplicate'],
  },
  (ctx, emit) => {
    const out: HealthFinding[] = [];
    for (const menu of rowsOf(ctx, 'ReactionRoleMenu')) {
      const seen = new Map<string, string>();
      const sorted = [...(menu.options ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      for (const option of sorted) {
        const params = { menu: menu.name, emoji: option.emoji, roleId: option.roleId };
        const at: FindingTarget = { entity: 'ReactionRoleOption', rowId: option.id, field: 'emoji', params };
        const role = roleProblem(ctx, option.roleId);
        // The roleDelete cleaner removes an option whose role is gone.
        const roleAt = { ...at, field: 'roleId', refId: option.roleId };
        if (role) out.push(emit(`role_${role}`, 'block', role === 'missing' ? 'auto' : 'manual', roleAt));
        const key = optionEmojiKey(option.emoji);
        const kept = key === null ? undefined : seen.get(key);
        if (key === null) out.push(emit('emoji_invalid', 'block', 'manual', at));
        // Two options on one emoji collide in the lookup, so only one of their roles can ever be given.
        else if (kept !== undefined)
          out.push(emit('emoji_duplicate', 'degraded', 'manual', { ...at, params: { ...params, keptEmoji: kept } }));
        else seen.set(key, option.emoji);
      }
    }
    return out;
  },
);

export const REACTION_ROLE_CHECKS: readonly HealthCheck[] = [menus, options];
