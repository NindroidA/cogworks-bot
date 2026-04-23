/**
 * Analytics API handlers
 *
 * Five read-only endpoints that back the web dashboard's analytics views:
 *
 *   GET /analytics/overview   — current-period summary + %change vs previous window
 *   GET /analytics/growth     — daily joins/leaves/totalMembers for charting
 *   GET /analytics/channels   — per-channel message totals (aggregated from daily topChannels)
 *   GET /analytics/hours      — 24-hour activity heatmap (powered by hourlyCounts)
 *   GET /analytics/snapshots  — raw snapshot rows for a date range
 *
 * All endpoints are guild-scoped by the caller (router strips guildId from
 * the path), use `lazyRepo()` for DB access, and return empty collections
 * rather than 404s when no snapshots exist for the guild. Date ranges are
 * clamped to `MAX_RANGE_DAYS` to prevent runaway queries.
 */

import type { Client } from 'discord.js';
import { Between } from 'typeorm';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { lazyRepo } from '../../database/lazyRepo';
import { ApiError } from '../apiError';
import type { RouteHandler } from '../router';

const analyticsRepo = lazyRepo(AnalyticsSnapshot);

/** Maximum span any analytics query can cover (contract constraint). */
const MAX_RANGE_DAYS = 365;

// ---------------------------------------------------------------------------
// Query-param parsing helpers — kept local to avoid muddying api/helpers.ts,
// which is dedicated to body-field extraction.
// ---------------------------------------------------------------------------

interface DayWindow {
  days: number;
  from: Date; // inclusive, UTC midnight
  to: Date; // inclusive, UTC midnight
}

/** Midnight-UTC boundary for the given date. */
function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function addDaysUtc(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function parseIsoDate(raw: string | null): Date | null {
  if (!raw) return null;
  // Accept YYYY-MM-DD; reject anything else to keep the API surface tight.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve `?days=N` into a start/end window (inclusive, UTC midnights).
 * Defaults to `fallbackDays` when absent; clamps to `[1, MAX_RANGE_DAYS]`.
 * Returns the last N days *ending today*, matching the dashboard's usual
 * "last week / last month" mental model.
 */
function parseDaysWindow(url: string, fallbackDays: number): DayWindow {
  const params = new URL(url, 'http://localhost').searchParams;
  const rawDays = params.get('days');
  const parsed = rawDays ? Number.parseInt(rawDays, 10) : fallbackDays;
  if (Number.isNaN(parsed) || parsed <= 0) throw ApiError.badRequest('`days` must be a positive integer');
  const days = Math.min(parsed, MAX_RANGE_DAYS);

  const today = startOfDayUtc(new Date());
  const from = addDaysUtc(today, -(days - 1));
  return { days, from, to: today };
}

/** Resolve `?from=YYYY-MM-DD&to=YYYY-MM-DD` for the snapshots endpoint. */
function parseFromToWindow(url: string): { from: Date; to: Date } {
  const params = new URL(url, 'http://localhost').searchParams;
  const from = parseIsoDate(params.get('from'));
  const to = parseIsoDate(params.get('to'));
  if (!from || !to) throw ApiError.badRequest('`from` and `to` must be YYYY-MM-DD dates');
  if (from > to) throw ApiError.badRequest('`from` must be on or before `to`');
  const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw ApiError.badRequest(`Range exceeds ${MAX_RANGE_DAYS} days`);
  }
  return { from, to };
}

/**
 * Format a %change string the way the dashboard expects: `"+12%"`, `"-3%"`,
 * or `"—"` when the previous value is zero (so we don't divide by zero or
 * claim "+∞%").
 */
function pctChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '0%' : '—';
  const delta = ((current - previous) / previous) * 100;
  const rounded = Math.round(delta);
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function registerAnalyticsHandlers(_client: Client, routes: Map<string, RouteHandler>): void {
  // GET /internal/guilds/:guildId/analytics/overview
  // Summary of the last 7 days + %change vs the previous 7 days.
  routes.set('GET /analytics/overview', async (guildId, _body, url) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const rawDays = params.get('days');
    const parsed = rawDays ? Number.parseInt(rawDays, 10) : 7;
    if (Number.isNaN(parsed) || parsed <= 0) throw ApiError.badRequest('`days` must be a positive integer');
    const days = Math.min(parsed, MAX_RANGE_DAYS);

    const today = startOfDayUtc(new Date());
    const windowFrom = addDaysUtc(today, -(days - 1));
    const prevTo = addDaysUtc(windowFrom, -1);
    const prevFrom = addDaysUtc(prevTo, -(days - 1));

    const [current, previous] = await Promise.all([
      analyticsRepo.find({
        where: { guildId, date: Between(windowFrom, today) },
      }),
      analyticsRepo.find({
        where: { guildId, date: Between(prevFrom, prevTo) },
      }),
    ]);

    const sum = (rows: AnalyticsSnapshot[], pick: (r: AnalyticsSnapshot) => number) =>
      rows.reduce((acc, r) => acc + pick(r), 0);

    const messages = sum(current, r => r.messageCount);
    // activeMembers is a daily-unique count; summing over-counts users who
    // were active on multiple days. For the overview card we accept the
    // imprecision — a true unique-over-window needs per-user storage.
    const activeMembers = sum(current, r => r.activeMembers);
    const joins = sum(current, r => r.memberJoined);
    const leaves = sum(current, r => r.memberLeft);
    const voiceMinutes = sum(current, r => r.voiceMinutes);

    // Aggregate topChannels across the window.
    const channelTotals = new Map<string, { channelId: string; channelName: string; messages: number }>();
    for (const snap of current) {
      if (!snap.topChannels) continue;
      for (const c of snap.topChannels) {
        const existing = channelTotals.get(c.channelId);
        if (existing) {
          existing.messages += c.count;
        } else {
          channelTotals.set(c.channelId, {
            channelId: c.channelId,
            channelName: c.name,
            messages: c.count,
          });
        }
      }
    }
    const topChannels = [...channelTotals.values()].sort((a, b) => b.messages - a.messages).slice(0, 5);

    const prevMessages = sum(previous, r => r.messageCount);
    const prevActive = sum(previous, r => r.activeMembers);
    const prevJoins = sum(previous, r => r.memberJoined);
    const prevLeaves = sum(previous, r => r.memberLeft);
    const prevVoice = sum(previous, r => r.voiceMinutes);

    return {
      period: `${days}d`,
      messages,
      activeMembers,
      joins,
      leaves,
      voiceMinutes,
      topChannels,
      comparedToPrevious: {
        messages: pctChange(messages, prevMessages),
        activeMembers: pctChange(activeMembers, prevActive),
        joins: pctChange(joins, prevJoins),
        leaves: pctChange(leaves, prevLeaves),
        voiceMinutes: pctChange(voiceMinutes, prevVoice),
      },
    };
  });

  // GET /internal/guilds/:guildId/analytics/growth?days=30
  routes.set('GET /analytics/growth', async (guildId, _body, url) => {
    const { days, from, to } = parseDaysWindow(url, 30);
    const rows = await analyticsRepo.find({
      where: { guildId, date: Between(from, to) },
      order: { date: 'ASC' },
    });

    const data = rows.map(r => ({
      date: formatIsoDate(r.date instanceof Date ? r.date : new Date(r.date)),
      joins: r.memberJoined,
      leaves: r.memberLeft,
      totalMembers: r.memberCount,
    }));

    return { days, data };
  });

  // GET /internal/guilds/:guildId/analytics/channels?days=7
  routes.set('GET /analytics/channels', async (guildId, _body, url) => {
    const { days, from, to } = parseDaysWindow(url, 7);
    const rows = await analyticsRepo.find({
      where: { guildId, date: Between(from, to) },
    });

    // Aggregate topChannels across the window, combining same channelId rows.
    const acc = new Map<string, { channelId: string; channelName: string; messages: number }>();
    for (const snap of rows) {
      if (!snap.topChannels) continue;
      for (const c of snap.topChannels) {
        const existing = acc.get(c.channelId);
        if (existing) {
          existing.messages += c.count;
          // Prefer the most recent name we've seen — channel renames are rare
          // but we want the latest label rather than whichever came first.
          existing.channelName = c.name;
        } else {
          acc.set(c.channelId, {
            channelId: c.channelId,
            channelName: c.name,
            messages: c.count,
          });
        }
      }
    }

    const channels = [...acc.values()]
      .sort((a, b) => b.messages - a.messages)
      // `uniqueUsers` isn't tracked per-channel yet — returning 0 keeps the
      // contract shape stable until we add channelUniqueUsers in a later
      // migration. Documented in CHANGELOG 3.1.2.
      .map(c => ({ ...c, uniqueUsers: 0 }));

    return { days, channels };
  });

  // GET /internal/guilds/:guildId/analytics/hours?days=7
  routes.set('GET /analytics/hours', async (guildId, _body, url) => {
    const { days, from, to } = parseDaysWindow(url, 7);
    const rows = await analyticsRepo.find({
      where: { guildId, date: Between(from, to) },
    });

    // Sum hourly histograms across the window. Days written before the
    // hourlyCounts column existed have null histograms — we skip those
    // rather than distorting the heatmap with synthesized data.
    const totals = new Array(24).fill(0) as number[];
    for (const snap of rows) {
      if (!snap.hourlyCounts) continue;
      for (let i = 0; i < 24; i += 1) {
        totals[i] += snap.hourlyCounts[i] ?? 0;
      }
    }

    const hourly = totals.map((messages, hour) => ({ hour, messages }));
    return { days, hourly };
  });

  // GET /internal/guilds/:guildId/analytics/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
  routes.set('GET /analytics/snapshots', async (guildId, _body, url) => {
    const { from, to } = parseFromToWindow(url);
    const rows = await analyticsRepo.find({
      where: { guildId, date: Between(from, to) },
      order: { date: 'ASC' },
    });

    const snapshots = rows.map(r => ({
      date: formatIsoDate(r.date instanceof Date ? r.date : new Date(r.date)),
      // Field names align with overview/growth/channels/hours: `messages` /
      // `joins` / `leaves`. The entity columns are still `messageCount` /
      // `memberJoined` / `memberLeft`, but we present a consistent surface.
      messages: r.messageCount,
      joins: r.memberJoined,
      leaves: r.memberLeft,
      voiceMinutes: r.voiceMinutes,
      activeMembers: r.activeMembers,
    }));

    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
      snapshots,
    };
  });
}

// ---------------------------------------------------------------------------
// Exports for unit tests — the pure helpers are worth covering directly.
// ---------------------------------------------------------------------------

export const __testing = {
  parseDaysWindow,
  parseFromToWindow,
  pctChange,
  formatIsoDate,
  MAX_RANGE_DAYS,
};
