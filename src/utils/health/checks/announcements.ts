/**
 * Announcement health checks (design inventory §3.4): the default channel and
 * ping role, and the template rows `/announcement send` renders.
 */
import type { AnnouncementTemplate } from '../../../typeorm/entities/announcement/AnnouncementTemplate';
import { DEFAULT_ANNOUNCEMENT_TEMPLATES } from '../../announcement/defaultTemplates';
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { resolveRole } from '../refs';
import type { HealthCheck, HealthFinding } from '../types';
import { botLacks, channelFindings, channelNames, EMBED_SEND } from './featureRefs';

const config = defineCheck(
  {
    id: 'announcement.config',
    system: 'announcement',
    entities: ['AnnouncementConfig'],
    names: ['channel_unset', ...channelNames('channel'), 'role_missing', 'role_not_mentionable'],
    isConfigured: ctx => rowsOf(ctx, 'AnnouncementConfig').length > 0,
  },
  (ctx, emit) => {
    const row = rowsOf(ctx, 'AnnouncementConfig')[0];
    if (!row) return [];
    const at: FindingTarget = { entity: 'AnnouncementConfig', rowId: row.id, field: 'defaultChannelId' };
    // `/announcement send` without a channel option posts here. '' is what channelDelete leaves behind.
    // `/announcement-setup` accepts any channel type, so the id may be a thread. Archived threads aren't
    // cached, so a miss proves nothing: channel_missing would need a REST confirmation, which isn't made.
    // A cached thread reads wrong_type: the send handler only posts to text and announcement channels.
    const rule = { kinds: ['text', 'news'], perms: EMBED_SEND, severity: 'degraded', mayBeThread: true } as const;
    const out = row.defaultChannelId
      ? channelFindings(ctx, emit, 'channel', row.defaultChannelId, at, rule)
      : [emit('channel_unset', 'degraded', 'manual', at)];
    if (!row.defaultRoleId) return out;

    const roleId = row.defaultRoleId;
    const roleAt: FindingTarget = { ...at, field: 'defaultRoleId', refId: roleId, params: { roleId } };
    const role = resolveRole(ctx.guild, roleId);
    if (role.status === 'missing') out.push(emit('role_missing', 'degraded', 'auto', roleAt));
    // Templates with "mention role" ping it; a non-mentionable role only pings with MentionEveryone.
    else if (role.status === 'ok' && !role.value.mentionable && botLacks(ctx, 'MentionEveryone'))
      out.push(emit('role_not_mentionable', 'degraded', 'manual', roleAt));
    return out;
  },
);

/** Discord's embed limits; renderTemplate passes these through, so the send throws. */
function exceedsEmbedLimits(t: AnnouncementTemplate): boolean {
  const fields = Array.isArray(t.fields) ? t.fields : [];
  return (
    (t.title?.length ?? 0) > 256 ||
    (t.body?.length ?? 0) > 4096 ||
    (t.footerText?.length ?? 0) > 2048 ||
    fields.length > 25 ||
    fields.some(f => String(f?.name ?? '').length > 256 || String(f?.value ?? '').length > 1024)
  );
}

const DEFAULT_NAMES = DEFAULT_ANNOUNCEMENT_TEMPLATES.map(t => t.name);

const templates = defineCheck(
  {
    id: 'announcement.template',
    system: 'announcement',
    entities: ['AnnouncementConfig', 'AnnouncementTemplate'],
    names: ['default_missing', 'color_invalid', 'exceeds_limits'],
    // Only the config decides whether announcements are set up.
    isConfigured: () => false,
  },
  (ctx, emit) => {
    const rows = rowsOf(ctx, 'AnnouncementTemplate');
    const out: HealthFinding[] = [];
    // Defaults are seeded once at setup, so ones added in later versions never reached older guilds.
    // Neither /announcement nor the dashboard can delete one; a custom template with the name counts as present.
    if (rowsOf(ctx, 'AnnouncementConfig').length > 0) {
      const names = new Set(rows.map(row => row.name));
      for (const name of DEFAULT_NAMES.filter(n => !names.has(n)))
        out.push(emit('default_missing', 'cosmetic', 'auto', { entity: 'AnnouncementTemplate', params: { name } }));
    }
    for (const row of rows) {
      const at: FindingTarget = { entity: 'AnnouncementTemplate', rowId: row.id, params: { name: row.name } };
      // Same parse as renderTemplate; the embed builder rejects NaN and out-of-range colors.
      const color = Number.parseInt(String(row.color).replace('#', ''), 16);
      if (!(color >= 0 && color <= 0xffffff)) {
        const params = { ...at.params, color: String(row.color) };
        out.push(emit('color_invalid', 'degraded', 'manual', { ...at, field: 'color', params }));
      }
      if (exceedsEmbedLimits(row)) out.push(emit('exceeds_limits', 'degraded', 'manual', at));
    }
    return out;
  },
);

export const ANNOUNCEMENT_CHECKS: readonly HealthCheck[] = [config, templates];
