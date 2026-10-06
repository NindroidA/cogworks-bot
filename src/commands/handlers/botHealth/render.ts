/**
 * Renders a `HealthReport` for `/bot-health check`: the summary embed, finding
 * pages that stay inside Discord's embed limits, and the JSON export. Pure
 * functions; the handler owns the collector.
 */
import {
  ActionRowBuilder,
  type APIEmbedField,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { lang } from '../../../lang';
import { Colors } from '../../../utils/colors';
import { POST_LOOKUPS } from '../../../utils/health/checks/memory';
import { HEALTH_REST_BUDGET } from '../../../utils/health/context';
import type {
  HealthFinding,
  HealthReport,
  HealthSeverity,
  SystemHealthStatus,
  SystemReport,
} from '../../../utils/health/types';

const tl = lang.health.command;
const findingStrings = lang.health.findings as Record<string, string>;
const systemLabels = tl.systems as Record<string, string>;

const FINDINGS_PER_PAGE = 10;
/** Field characters per details page (Discord allows 6000 per embed; the rest is title and footer). */
const PAGE_FIELD_BUDGET = 5_400;

/** Collector-scoped custom ids (the global interaction router ignores them). */
export const HEALTH_CID = {
  system: 'bot_health:system',
  /** + `<system>:<page>` */
  page: 'bot_health:page:',
  summary: 'bot_health:summary',
  export: 'bot_health:export',
} as const;

export type HealthView = { kind: 'summary' } | { kind: 'details'; system: string; page: number };

export interface RenderOptions {
  /** Set when the bot owner checks another server, so the title names it. */
  guildName?: string;
  /** Systems a check of all systems lists as not checked yet (they have no checks). */
  notCheckedYet?: readonly string[];
}

/** Fills `{name}` placeholders; unknown ones stay as written. */
export function fillTemplate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    // typeof, not `in`: inherited keys such as `constructor` must not fill a placeholder.
    const value: unknown = params[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : match;
  });
}

const systemLabel = (system: string) => systemLabels[system] ?? system;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const SEVERITY_ORDER: Record<HealthSeverity, number> = { block: 0, degraded: 1, cosmetic: 2 };

/**
 * One embed field per finding: the severity as the name, the explanation (lang
 * string with its params) plus the stable code as the value. The lang strings
 * show a missing object as its raw ID and an existing one as a mention, and end
 * with what to do (or say nothing needs doing). No repair command exists yet, so
 * the repair class only goes in the JSON export.
 */
export function findingField(finding: HealthFinding): APIEmbedField {
  const suffix = `\n\`${finding.code}\``;
  const text = fillTemplate(findingStrings[finding.code] ?? finding.code, finding.params);
  return {
    name: truncate(tl.severity[finding.severity], 256),
    value: truncate(text, 1024 - suffix.length) + suffix,
  };
}

/** Pages of at most 10 fields whose combined length stays inside the embed budget. Worst first. */
export function paginateFindings(findings: readonly HealthFinding[], budget = PAGE_FIELD_BUDGET): APIEmbedField[][] {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const pages: APIEmbedField[][] = [];
  let page: APIEmbedField[] = [];
  let size = 0;
  for (const field of sorted.map(findingField)) {
    const length = field.name.length + field.value.length;
    if (page.length > 0 && (page.length >= FINDINGS_PER_PAGE || size + length > budget)) {
      pages.push(page);
      page = [];
      size = 0;
    }
    page.push(field);
    size += length;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

const STATUS_LINE: Record<SystemHealthStatus, string> = {
  ok: tl.summary.ok,
  warn: tl.summary.warn,
  fail: tl.summary.fail,
  not_configured: tl.summary.notConfigured,
};

const systemsOf = (report: HealthReport) => Object.entries(report.systems) as [string, SystemReport][];

const NOT_CHECKED: Record<string, string> = {
  'guild-cache-unavailable': tl.notChecked.guildUnavailable,
  'bot-member-unavailable': tl.notChecked.botMember,
};
/** What a REST lookup label covers, in words; an unknown label is shown as is. */
const restLabels = tl.notChecked.labels as Record<string, string>;
/**
 * The budget is fixed and rows load in the same order, so a deep run that skips
 * lookups skips the same ones every time: say what and why, not "try again".
 */
function notCheckedText(item: string): string {
  if (NOT_CHECKED[item]) return NOT_CHECKED[item];
  if (!item.startsWith('rest:')) return item;
  const label = item.slice('rest:'.length);
  return fillTemplate(tl.notChecked.rest, {
    label: restLabels[label] ?? label,
    max: HEALTH_REST_BUDGET.maxCalls,
    posts: POST_LOOKUPS,
  });
}

export function buildSummaryEmbed(report: HealthReport, opts: RenderOptions = {}): EmbedBuilder {
  const systems = systemsOf(report);
  const time = Math.floor(Date.parse(report.checkedAt) / 1000);
  const meta = fillTemplate(report.deep ? tl.summary.metaDeep : tl.summary.meta, { version: report.botVersion, time });
  const lines = [meta, ''];
  for (const [system, r] of systems) {
    lines.push(fillTemplate(STATUS_LINE[r.status], { system: systemLabel(system), count: r.findings.length }));
  }
  for (const system of opts.notCheckedYet ?? []) {
    if (!(system in report.systems))
      lines.push(fillTemplate(tl.summary.notCheckedYet, { system: systemLabel(system) }));
  }
  if (systems.length === 0 && !opts.notCheckedYet?.length) lines.push(tl.summary.noChecks);
  if (systems.some(([, r]) => r.findings.length > 0)) lines.push('', tl.summary.hint);

  const statuses = new Set(systems.map(([, r]) => r.status));
  const color = statuses.has('fail') ? 'error' : statuses.has('warn') ? 'warning' : 'success';
  const title = opts.guildName ? fillTemplate(tl.summary.titleFor, { guildName: opts.guildName }) : tl.summary.title;
  const embed = new EmbedBuilder()
    .setTitle(truncate(title, 256))
    .setColor(Colors.status[color])
    .setDescription(lines.join('\n'));
  const notChecked = report.notChecked.map(notCheckedText).join('\n');
  if (notChecked) embed.addFields({ name: tl.summary.notChecked, value: truncate(notChecked, 1024) });
  return embed;
}

function systemSelect(report: HealthReport, current?: string): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const withFindings = systemsOf(report).filter(([, result]) => result.findings.length > 0);
  if (withFindings.length === 0) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(HEALTH_CID.system)
    .setPlaceholder(tl.details.placeholder)
    .addOptions(
      withFindings.slice(0, 25).map(([system, result]) => ({
        label: truncate(systemLabel(system), 100),
        value: system,
        description: fillTemplate(tl.details.findings, { count: result.findings.length }),
        default: system === current,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function exportButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(HEALTH_CID.export)
    .setLabel(tl.export.button)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📄');
}

/** The embed and components for one view. An out-of-range page is clamped; a system with nothing found shows the summary. */
export function renderView(report: HealthReport, view: HealthView, opts: RenderOptions = {}) {
  const findings =
    view.kind === 'details' ? (report.systems[view.system as keyof HealthReport['systems']]?.findings ?? []) : [];
  if (view.kind === 'summary' || findings.length === 0) {
    const select = systemSelect(report);
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(exportButton());
    return { embeds: [buildSummaryEmbed(report, opts)], components: select ? [select, buttons] : [buttons] };
  }

  const pages = paginateFindings(findings);
  const page = Math.min(Math.max(view.page, 0), pages.length - 1);
  const embed = new EmbedBuilder()
    .setTitle(truncate(fillTemplate(tl.details.title, { system: systemLabel(view.system) }), 256))
    .setColor(Colors.status.info)
    .addFields(pages[page])
    .setFooter({ text: fillTemplate(tl.details.page, { page: page + 1, pages: pages.length }) });
  const pageButton = (target: number, label: string, emoji: string) =>
    new ButtonBuilder()
      .setCustomId(`${HEALTH_CID.page}${view.system}:${target}`)
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(target < 0 || target >= pages.length);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    pageButton(page - 1, tl.details.previous, '◀️'),
    pageButton(page + 1, tl.details.next, '▶️'),
    new ButtonBuilder().setCustomId(HEALTH_CID.summary).setLabel(tl.details.back).setStyle(ButtonStyle.Secondary),
    exportButton(),
  );
  const select = systemSelect(report, view.system);
  return { embeds: [embed], components: select ? [select, buttons] : [buttons] };
}

/** The view a component click asks for, or null for one this view doesn't own (the export button). */
export function parseViewRequest(customId: string, values: readonly string[] = []): HealthView | null {
  if (customId === HEALTH_CID.summary) return { kind: 'summary' };
  if (customId === HEALTH_CID.system && values[0]) return { kind: 'details', system: values[0], page: 0 };
  if (customId.startsWith(HEALTH_CID.page)) {
    const [system, page] = customId.slice(HEALTH_CID.page.length).split(':');
    const n = Number(page);
    return system && Number.isInteger(n) ? { kind: 'details', system, page: n } : null;
  }
  return null;
}

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * The params an export keeps: numbers, Discord IDs, and the missing-permission
 * list (the bot's own permission names). Names, titles, labels, emoji, colors
 * and admin-chosen ids are dropped, since they can hold server text.
 */
export function exportParams(params: HealthFinding['params']): HealthFinding['params'] {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) => typeof value === 'number' || SNOWFLAKE.test(value) || key === 'permissions',
    ),
  );
}

/**
 * The full report as a JSON file for support: IDs, finding codes, severities and
 * repair classes, counts and numbers only. No channel, role or server names, and
 * no titles or other text from the server's settings.
 */
export function buildExportAttachment(report: HealthReport): AttachmentBuilder {
  const stamp = report.checkedAt.replace(/[:.]/g, '-');
  const systems = Object.fromEntries(
    systemsOf(report).map(([system, result]) => [
      system,
      { ...result, findings: result.findings.map(f => ({ ...f, params: exportParams(f.params) })) },
    ]),
  );
  return new AttachmentBuilder(Buffer.from(JSON.stringify({ ...report, systems }, null, 2)), {
    name: `bot-health-${report.guildId}-${stamp}.json`,
  });
}
