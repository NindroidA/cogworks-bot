/**
 * Application health checks (design inventory §3.3). Same shape as tickets: the
 * panel with its category and archive forum, positions, and open applications,
 * using the helpers in `tickets.ts`.
 */
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { resolveChannel } from '../refs';
import type { HealthCheck, HealthFinding, HealthSeverity } from '../types';
import {
  ARCHIVE_NAMES,
  checkArchiveForum,
  checkCustomFields,
  checkPanel,
  EMOJI_NAMES,
  emojiChecker,
  FIELD_NAMES,
  hasRow,
  LIMITS,
  notConfigSource,
  PANEL_NAMES,
} from './tickets';

const panel = defineCheck(
  {
    id: 'application.panel',
    system: 'application',
    entities: ['ApplicationConfig', 'ArchivedApplicationConfig'],
    names: PANEL_NAMES,
    isConfigured: hasRow('ApplicationConfig'),
  },
  (ctx, emit) =>
    checkPanel(
      ctx,
      emit,
      'ApplicationConfig',
      rowsOf(ctx, 'ApplicationConfig')[0],
      rowsOf(ctx, 'ArchivedApplicationConfig')[0]?.channelId,
    ),
);

/** Outcome tags the close flow adds next to the position tag. */
const OUTCOME_TAGS = ['Accepted', 'Rejected'];

const archive = defineCheck(
  {
    id: 'application.archive',
    system: 'application',
    entities: ['ArchivedApplicationConfig', 'Position'],
    names: ARCHIVE_NAMES,
    isConfigured: hasRow('ArchivedApplicationConfig'),
  },
  (ctx, emit) => {
    const titles = rowsOf(ctx, 'Position')
      .filter(position => position.isActive)
      .map(position => position.title);
    const config = rowsOf(ctx, 'ArchivedApplicationConfig')[0];
    return checkArchiveForum(ctx, emit, 'ArchivedApplicationConfig', config, [...titles, ...OUTCOME_TAGS]);
  },
);

const positions = defineCheck(
  {
    id: 'application.position',
    system: 'application',
    entities: ['Position', 'ApplicationConfig'],
    names: ['too_many_active', 'none_active', ...EMOJI_NAMES, ...FIELD_NAMES],
    isConfigured: hasRow('ApplicationConfig'),
  },
  async (ctx, emit) => {
    const rows = rowsOf(ctx, 'Position');
    const active = rows.filter(position => position.isActive);
    const out: HealthFinding[] = [];
    const all: FindingTarget = { entity: 'Position', field: 'isActive' };
    // The panel has one Apply button per position, and a message holds 5 rows of 5.
    if (active.length > LIMITS.panelButtons)
      out.push(emit('too_many_active', 'block', 'manual', { ...all, params: { count: active.length } }));
    if (active.length === 0 && rowsOf(ctx, 'ApplicationConfig')[0]?.channelId)
      out.push(emit('none_active', 'degraded', 'manual', all));

    const checkEmoji = emojiChecker(ctx);
    for (const position of rows) {
      // An inactive position has no button, so its problems wait until someone turns it on.
      const severity: HealthSeverity = position.isActive ? 'block' : 'cosmetic';
      const at: FindingTarget = { entity: 'Position', rowId: position.id, params: { name: position.title } };
      out.push(...(await checkEmoji(position.emoji, emit, at, severity)));
      out.push(...checkCustomFields(emit, position.customFields, at, severity));
    }
    return out;
  },
);

const openApplications = defineCheck(
  {
    id: 'application.open',
    system: 'application',
    entities: ['Application'],
    names: ['channel_missing'],
    isConfigured: notConfigSource,
  },
  (ctx, emit) =>
    rowsOf(ctx, 'Application')
      .filter(app => app.status !== 'closed' && app.channelId)
      .filter(app => resolveChannel(ctx.guild, app.channelId as string).status === 'missing')
      .map(app =>
        emit('channel_missing', 'degraded', 'confirm', {
          entity: 'Application',
          rowId: app.id,
          field: 'channelId',
          refId: app.channelId as string,
          params: { applicationId: app.id, channelId: app.channelId as string },
        }),
      ),
);

export const APPLICATION_CHECKS: readonly HealthCheck[] = [panel, archive, positions, openApplications];
