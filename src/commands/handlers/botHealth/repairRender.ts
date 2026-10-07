/**
 * Renders `/bot-health repair`: the preview of a repair plan (automatic fixes
 * grouped by what they do, fixes to confirm in a paged multi-select) and the
 * results of applying one. Pure functions that stay inside Discord's limits;
 * the handler owns the collector.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { fmt, lang } from '../../../lang';
import { Colors } from '../../../utils/colors';
import { buildErrorMessage } from '../../../utils/discord/verifiedDelete';
import type { RepairResult, StepOutcome } from '../../../utils/health/repair/applier';
import { findingKey } from '../../../utils/health/repair/keys';
import type { RepairFix, RepairPlan } from '../../../utils/health/repair/types';
import type { HealthReport } from '../../../utils/health/types';
import { buildSummaryEmbed, type FixableKeys, findingText, truncate } from './render';

const tl = lang.health.command;
const tr = tl.repair;

/** Collector-scoped custom ids (the global interaction router ignores them). */
export const REPAIR_CID = {
  auto: 'bot_health:repair:auto',
  select: 'bot_health:repair:select',
  /** + the page number */
  page: 'bot_health:repair:page:',
  apply: 'bot_health:repair:apply',
  cancel: 'bot_health:repair:cancel',
  again: 'bot_health:repair:again',
} as const;

/** Discord allows 25 options per select menu. */
export const CONFIRM_PER_PAGE = 25;
/** The description's share of the 6000 characters per embed (the fields take at most ~1200 more). */
const DESCRIPTION_BUDGET = 3_500;

/** One preview: a check's report, its full plan, the page of fixes to confirm, and the keys picked so far (on any page). */
export interface PreviewState {
  report: HealthReport;
  plan: RepairPlan;
  page: number;
  selected: Set<string>;
}

export interface RepairRenderOptions {
  /** Set when the bot owner repairs another server. */
  guildName?: string;
  /** Every component greyed out (while a repair runs). */
  disabled?: boolean;
}

export const fixesOf = (plan: RepairPlan): FixableKeys => new Map(plan.fixes.map(fix => [fix.key, fix.repair]));
export const confirmFixes = (plan: RepairPlan) => plan.fixes.filter(fix => fix.repair === 'confirm');
export const autoKeys = (plan: RepairPlan) => plan.fixes.filter(fix => fix.repair === 'auto').map(fix => fix.key);
const findingsOf = (report: HealthReport) => Object.values(report.systems).flatMap(system => system?.findings ?? []);

/** "(deletes N saved memories)" after a fix that deletes a memory channel's posts with it; else nothing. */
function memoriesText(count: number): string {
  if (count === 0) return '';
  return ` ${count === 1 ? tr.preview.memory : fmt(tr.preview.memories, { count })}`;
}

/** Lines that fit in `max` characters; the rest become one "…and N more" line. */
export function fitLines(lines: readonly string[], max: number): string {
  const kept: string[] = [];
  let size = 0;
  for (const line of lines) {
    // Keep room for the "…and N more" line unless this is the last one.
    const reserve = lines.length - kept.length > 1 ? 24 : 0;
    if (size + line.length + 1 + reserve > max) break;
    kept.push(line);
    size += line.length + 1;
  }
  const left = lines.length - kept.length;
  if (left > 0) kept.push(fmt(tr.preview.more, { count: left }));
  return kept.join('\n');
}

/** Automatic fixes as "label ×N", one line per kind of fix, with the memories they delete. */
function autoLines(fixes: readonly RepairFix[]): string[] {
  const groups = new Map<string, { count: number; memories: number }>();
  for (const fix of fixes) {
    const group = groups.get(fix.label) ?? { count: 0, memories: 0 };
    group.count++;
    group.memories += fix.cascade?.MemoryItem ?? 0;
    groups.set(fix.label, group);
  }
  return [...groups].map(
    ([label, group]) =>
      fmt(tr.preview.autoLine, { label: truncate(label, 150), count: group.count }) + memoriesText(group.memories),
  );
}

function button(id: string, label: string, style: ButtonStyle, disabled: boolean): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id).setLabel(truncate(label, 80)).setStyle(style).setDisabled(disabled);
}

/** The preview embed and its components. An out-of-range page is clamped. */
export function renderPreview(state: PreviewState, opts: RepairRenderOptions = {}) {
  const { report, plan } = state;
  const disabled = opts.disabled ?? false;
  const auto = plan.fixes.filter(fix => fix.repair === 'auto');
  const confirm = confirmFixes(plan);
  const pages = Math.max(1, Math.ceil(confirm.length / CONFIRM_PER_PAGE));
  const page = Math.min(Math.max(state.page, 0), pages - 1);
  const first = page * CONFIRM_PER_PAGE;
  const onPage = confirm.slice(first, first + CONFIRM_PER_PAGE);

  const time = Math.floor(Date.parse(report.checkedAt) / 1000);
  const meta = fmt(report.deep ? tl.summary.metaDeep : tl.summary.meta, { version: report.botVersion, time });
  const head = [meta, '', plan.fixes.length > 0 ? tr.preview.intro : tr.preview.nothing];
  if (confirm.length > 0) head.push('', fmt(tr.preview.confirm, { count: confirm.length }));
  const confirmLines = onPage.map(
    (fix, i) =>
      fmt(tr.preview.confirmLine, { number: first + i + 1, label: truncate(fix.label, 100) }) +
      memoriesText(fix.cascade?.MemoryItem ?? 0),
  );
  const description = [...head, fitLines(confirmLines, DESCRIPTION_BUDGET - head.join('\n').length)];

  const title = opts.guildName ? fmt(tr.preview.titleFor, { guildName: opts.guildName }) : tr.preview.title;
  const embed = new EmbedBuilder()
    .setTitle(truncate(title, 256))
    .setColor(Colors.status.info)
    .setDescription(description.join('\n').trim());
  if (auto.length > 0) {
    embed.addFields({ name: fmt(tr.preview.auto, { count: auto.length }), value: fitLines(autoLines(auto), 1024) });
  }
  const manual = new Set(findingsOf(report).map(findingKey)).size - plan.fixes.length;
  if (manual > 0) embed.addFields({ name: fmt(tr.preview.manual, { count: manual }), value: tr.preview.manualText });
  if (pages > 1) embed.setFooter({ text: fmt(tr.preview.page, { page: page + 1, pages }) });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (onPage.length > 0) {
    const findings = new Map(findingsOf(report).map(f => [findingKey(f), f]));
    const options = onPage.map((fix, i) => {
      const finding = findings.get(fix.key);
      const detail = finding ? truncate(findingText(finding).replace(/[`*]/g, ''), 100) : '';
      return {
        label: truncate(`${first + i + 1}. ${fix.label}`, 100),
        value: fix.key,
        ...(detail ? { description: detail } : {}),
        default: state.selected.has(fix.key),
      };
    });
    const select = new StringSelectMenuBuilder()
      .setCustomId(REPAIR_CID.select)
      .setPlaceholder(tr.preview.placeholder)
      .setMinValues(0)
      .setMaxValues(options.length)
      .setDisabled(disabled)
      .addOptions(options);
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select));
  }
  const buttons = [
    button(
      REPAIR_CID.auto,
      fmt(tr.preview.applyAuto, { count: auto.length }),
      ButtonStyle.Success,
      disabled || !auto.length,
    ),
    button(
      REPAIR_CID.apply,
      fmt(tr.preview.applySelected, { count: state.selected.size }),
      ButtonStyle.Primary,
      disabled || state.selected.size === 0,
    ),
  ];
  if (pages > 1) {
    const pageButton = (target: number, label: string) =>
      button(`${REPAIR_CID.page}${target}`, label, ButtonStyle.Secondary, disabled || target < 0 || target >= pages);
    buttons.push(pageButton(page - 1, tl.details.previous), pageButton(page + 1, tl.details.next));
  }
  buttons.push(button(REPAIR_CID.cancel, tr.preview.cancel, ButtonStyle.Secondary, disabled));
  if (plan.fixes.length > 0) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons));
  return { embeds: [embed], components: rows };
}

/** The page a page button asks for, or null for another component. */
export function parsePage(customId: string): number | null {
  if (!customId.startsWith(REPAIR_CID.page)) return null;
  const page = Number(customId.slice(REPAIR_CID.page.length));
  return Number.isInteger(page) ? page : null;
}

export type ResultBucket = 'applied' | 'changed' | 'unverified' | 'failed';

/** How the results summary groups the applier's outcomes. */
const BUCKET: Record<StepOutcome, ResultBucket> = {
  applied: 'applied',
  // The row changed or went, the object came back, or the template was added: the check's view is out of date.
  stale: 'changed',
  gone: 'changed',
  exists: 'changed',
  'skipped-not-missing': 'changed',
  'skipped-unverified': 'unverified',
  failed: 'failed',
};

/** Fixes per bucket: a step counts once for every fix it carries. */
export function resultCounts(result: RepairResult): Record<ResultBucket, number> {
  const counts: Record<ResultBucket, number> = { applied: 0, changed: 0, unverified: 0, failed: 0 };
  for (const { step, outcome } of result.results) counts[BUCKET[outcome]] += step.keys.length;
  return counts;
}

/**
 * What a repair did, then the summary of the check run right after it (when
 * that finished) with a button to preview what's left.
 */
export function renderResults(result: RepairResult, next: PreviewState | null, opts: RepairRenderOptions = {}) {
  const counts = resultCounts(result);
  const lines = [fmt(tr.results.applied, { count: counts.applied })];
  if (counts.changed > 0) lines.push(fmt(tr.results.changed, { count: counts.changed }));
  if (counts.unverified > 0) lines.push(fmt(tr.results.unverified, { count: counts.unverified }));
  if (counts.failed > 0) lines.push(buildErrorMessage(fmt(tr.results.failed, { count: counts.failed })));
  if (!next) lines.push('', tr.results.recheckFailed);
  const color = counts.failed > 0 ? 'error' : counts.applied > 0 ? 'success' : 'warning';
  const embeds = [
    new EmbedBuilder().setTitle(tr.results.title).setColor(Colors.status[color]).setDescription(lines.join('\n')),
  ];
  if (!next) return { embeds, components: [] };
  embeds.push(buildSummaryEmbed(next.report, { guildName: opts.guildName, fixable: fixesOf(next.plan) }));
  if (next.plan.fixes.length === 0) return { embeds, components: [] };
  const again = button(REPAIR_CID.again, tr.results.again, ButtonStyle.Primary, false);
  return { embeds, components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(again)] };
}
