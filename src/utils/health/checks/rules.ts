/**
 * Rules health check (design inventory §3.6): the rules channel and message,
 * the role the reaction grants, and the reaction emoji. The message is only
 * looked up in deep mode.
 */
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { missingPermissions, type PermissionName } from '../refs';
import type { HealthCheck, HealthFinding } from '../types';
import {
  channelParams,
  channelProblem,
  channelSeverity,
  MESSAGE_CHANNEL,
  messageStatus,
  REACTION_CRITICAL,
  roleProblem,
  UNICODE_EMOJI,
} from './refHelpers';

const RULES_PERMS: PermissionName[] = ['ViewChannel', 'SendMessages', 'AddReactions', 'ReadMessageHistory'];
/** The reaction handler compares `emoji.toString()`, so a custom emoji must be stored as `<:name:id>` / `<a:name:id>`. */
const RULES_CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;

const rules = defineCheck(
  {
    id: 'rules.config',
    system: 'rules',
    entities: ['RulesConfig'],
    isConfigured: ctx => rowsOf(ctx, 'RulesConfig').length > 0,
    names: [
      'channel_missing',
      'channel_wrong_type',
      'channel_permissions',
      'message_missing',
      'role_missing',
      'role_everyone',
      'role_managed',
      'role_too_high',
      'manage_roles',
      'emoji_invalid',
    ],
  },
  async (ctx, emit) => {
    const row = rowsOf(ctx, 'RulesConfig')[0];
    if (!row) return [];
    const at: FindingTarget = { entity: 'RulesConfig', rowId: row.id };
    const out: HealthFinding[] = [];

    const channel = channelProblem(ctx, row.channelId, MESSAGE_CHANNEL, RULES_PERMS);
    if (channel) {
      // The channelDelete cleaner deletes the whole config, custom message included, so confirm it.
      const repair = channel.problem === 'missing' ? 'confirm' : 'manual';
      const target = { ...at, field: 'channelId', refId: row.channelId, params: channelParams(row.channelId, channel) };
      out.push(emit(`channel_${channel.problem}`, channelSeverity(channel, REACTION_CRITICAL), repair, target));
    } else if ((await messageStatus(ctx, 'rules.message', row.channelId, row.messageId)) === 'missing') {
      const params = { channelId: row.channelId };
      out.push(
        emit('message_missing', 'block', 'confirm', { ...at, field: 'messageId', refId: row.messageId, params }),
      );
    }

    const role = roleProblem(ctx, row.roleId);
    const roleAt: FindingTarget = { ...at, field: 'roleId', refId: row.roleId, params: { roleId: row.roleId } };
    if (role) out.push(emit(`role_${role}`, 'block', 'manual', roleAt));
    if (ctx.me && missingPermissions(ctx.me, ['ManageRoles']).length > 0)
      out.push(emit('manage_roles', 'block', 'manual', roleAt));

    if (!RULES_CUSTOM_EMOJI.test(row.emoji) && !UNICODE_EMOJI.test(row.emoji))
      out.push(emit('emoji_invalid', 'block', 'manual', { ...at, field: 'emoji', params: { emoji: row.emoji } }));
    return out;
  },
);

export const RULES_CHECKS: readonly HealthCheck[] = [rules];
