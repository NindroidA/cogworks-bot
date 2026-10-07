/**
 * `/bot-health repair` renderer: the preview (automatic fixes grouped,
 * fixes to confirm paged 25 to a menu, what's left for the admin), Discord's
 * limits with 200 findings, and the results summary.
 */
import { describe, expect, test } from 'bun:test';
import type { APIEmbed } from 'discord.js';
import {
  CONFIRM_PER_PAGE,
  fitLines,
  optionText,
  type PreviewState,
  parsePage,
  REPAIR_CID,
  renderPreview,
  renderResults,
  resultCounts,
} from '../../../../src/commands/handlers/botHealth/repairRender';
import type { RepairResult, StepOutcome } from '../../../../src/utils/health/repair/applier';
import { findingKey } from '../../../../src/utils/health/repair/keys';
import { repairLabel } from '../../../../src/utils/health/repair/refRepairs';
import type { RepairFix, RepairStep } from '../../../../src/utils/health/repair/types';
import type { HealthFinding, HealthReport } from '../../../../src/utils/health/types';

const G = '100000000000000001';

function finding(code: string, rowId: number, over: Partial<HealthFinding> = {}): HealthFinding {
  return {
    code,
    system: 'core',
    severity: 'cosmetic',
    repair: 'auto',
    entity: 'StaffRole',
    rowId,
    params: { roleId: `2000000000000${String(rowId).padStart(5, '0')}`, alias: 'Mods' },
    ...over,
  };
}

function fixOf(f: HealthFinding, repair: RepairFix['repair'], over: Partial<RepairFix> = {}): RepairFix {
  const base = { key: findingKey(f), code: f.code, label: repairLabel(f.code), system: f.system, repair };
  return { ...base, entity: 'StaffRole', rowId: f.rowId, op: 'delete', changes: [], ...over };
}

function state(findings: HealthFinding[], fixes: RepairFix[], over: Partial<PreviewState> = {}): PreviewState {
  const report: HealthReport = {
    guildId: G,
    botVersion: '3.17.0',
    checkedAt: '2026-10-07T12:00:00.000Z',
    deep: false,
    systems: { core: { status: 'warn', findings } },
    counts: { auto: 0, confirm: 0, manual: 0 },
    notChecked: [],
  };
  return { report, plan: { fixes, steps: [], unsupported: [] }, page: 0, selected: new Set(), ...over };
}

/** Everything Discord counts toward the 6000-character embed total. */
function embedLength(embed: APIEmbed): number {
  const fields = (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + fields;
}

const componentsOf = (view: ReturnType<typeof renderPreview>) =>
  view.components.map(row => row.toJSON().components as Record<string, any>[]);

/**
 * 200 findings: 60 automatic of 40 kinds with labels near the limit, 120 to
 * confirm (one deleting a memory channel's 7 saved memories) with long
 * details, and 20 left for the admin.
 */
function twoHundred(): PreviewState {
  const huge = 'y'.repeat(3_000);
  const auto = Array.from({ length: 60 }, (_, i) => finding('core.staff_role.missing', i));
  const confirm = Array.from({ length: 120 }, (_, i) =>
    finding('ticket.restriction.unknown_type', 1_000 + i, { repair: 'confirm', params: { type: huge } }),
  );
  const manual = Array.from({ length: 20 }, (_, i) => finding('core.staff_role.unknown_type', 5_000 + i));
  const fixes = [
    ...auto.map((f, i) => fixOf(f, 'auto', { label: `${'L'.repeat(140)} ${i % 40}` })),
    ...confirm.map((f, i) => fixOf(f, 'confirm', i === 0 ? { cascade: { MemoryItem: 7 } } : {})),
  ];
  return state([...auto, ...confirm, ...manual], fixes);
}

describe('renderPreview', () => {
  test('200 findings: every page within Discord limits, every fix to confirm on exactly one page', () => {
    const s = twoHundred();
    const pages = Math.ceil(120 / CONFIRM_PER_PAGE);
    const seen: string[] = [];
    for (let page = 0; page < pages; page++) {
      const view = renderPreview({ ...s, page });
      const embed = view.embeds[0].toJSON();
      expect(embedLength(embed)).toBeLessThanOrEqual(6000);
      expect(embed.description!.length).toBeLessThanOrEqual(4096);
      expect(embed.fields!.length).toBeLessThanOrEqual(25);
      for (const field of embed.fields!) {
        expect(field.name.length).toBeLessThanOrEqual(256);
        expect(field.value.length).toBeLessThanOrEqual(1024);
      }
      expect(embed.footer?.text).toBe(`Fixes to confirm: page ${page + 1} of ${pages}`);

      const rows = componentsOf(view);
      expect(rows.length).toBeLessThanOrEqual(5);
      const [select] = rows[0];
      expect(select.options.length).toBeLessThanOrEqual(25);
      for (const option of select.options) {
        expect(option.label.length).toBeLessThanOrEqual(100);
        expect(option.description.length).toBeLessThanOrEqual(100);
        expect(option.description).not.toContain('`');
      }
      expect(select.max_values).toBe(select.options.length);
      expect(select.min_values).toBe(0);
      expect(rows[1].length).toBeLessThanOrEqual(5);
      seen.push(...select.options.map((o: { value: string }) => o.value));
    }
    expect(seen).toEqual(s.plan.fixes.filter(f => f.repair === 'confirm').map(f => f.key));
  });

  test('automatic fixes are grouped as "label ×N"; what does not fit is counted', () => {
    const view = renderPreview(twoHundred()).embeds[0].toJSON();
    const auto = view.fields!.find(f => f.name === 'Automatic fixes (60)')!;
    expect(auto.value).toMatch(/^• L+ 0 ×2$/m);
    expect(auto.value).toMatch(/…and \d+ more$/);
    expect(view.fields!.find(f => f.name === 'Left for you (20)')!.value).toContain('`/bot-health check`');
  });

  test('fixes to confirm are numbered across pages; a memory channel delete says how many memories go', () => {
    const s = twoHundred();
    const first = renderPreview(s).embeds[0].toJSON().description!;
    expect(first).toContain('**Fixes to confirm (120)**');
    expect(first).toContain(
      "`1.` Remove the ticket restriction for a type that doesn't exist (deletes 7 saved memories)",
    );
    const second = renderPreview({ ...s, page: 1 }).embeds[0].toJSON().description!;
    expect(second).toContain("`26.` Remove the ticket restriction for a type that doesn't exist");
    expect(second).not.toContain('`25.`');

    const one = finding('memory.forum.missing', 1, { repair: 'confirm' });
    const single = renderPreview(state([one], [fixOf(one, 'confirm', { cascade: { MemoryItem: 1 } })]));
    expect(single.embeds[0].toJSON().description).toContain('(deletes 1 saved memory)');
    const none = renderPreview(state([one], [fixOf(one, 'confirm', { cascade: { MemoryItem: 0 } })]));
    expect(none.embeds[0].toJSON().description).not.toContain('deletes');
  });

  test('picked fixes stay picked; the apply buttons count and enable; page buttons only with more than one page', () => {
    const s = twoHundred();
    const picked = s.plan.fixes.filter(f => f.repair === 'confirm')[3].key;
    const rows = componentsOf(renderPreview({ ...s, selected: new Set([picked]) }));
    expect(rows[0][0].options.find((o: { value: string }) => o.value === picked).default).toBe(true);
    const buttons = rows[1];
    expect(buttons.map(b => b.custom_id)).toEqual([
      REPAIR_CID.auto,
      REPAIR_CID.apply,
      `${REPAIR_CID.page}-1`,
      `${REPAIR_CID.page}1`,
      REPAIR_CID.cancel,
    ]);
    expect(buttons[0]).toMatchObject({ label: 'Apply automatic fixes (60)', disabled: false });
    expect(buttons[1]).toMatchObject({ label: 'Apply selected (1)', disabled: false });
    expect(buttons[2].disabled).toBe(true);

    const small = state(
      [finding('core.staff_role.missing', 1)],
      [fixOf(finding('core.staff_role.missing', 1), 'auto')],
    );
    const smallRows = componentsOf(renderPreview(small));
    expect(smallRows).toHaveLength(1);
    expect(smallRows[0].map(b => b.custom_id)).toEqual([REPAIR_CID.auto, REPAIR_CID.apply, REPAIR_CID.cancel]);
    expect(smallRows[0][1].disabled).toBe(true);
  });

  test('while a repair runs every component is disabled', () => {
    const rows = componentsOf(renderPreview(twoHundred(), { disabled: true }));
    for (const component of rows.flat()) expect(component.disabled).toBe(true);
  });

  test('nothing to fix: says so, no components; another server is named in the title', () => {
    const view = renderPreview(state([finding('core.staff_role.unknown_type', 1)], []), { guildName: 'Other' });
    const embed = view.embeds[0].toJSON();
    expect(embed.title).toBe('Repair preview: Other');
    expect(embed.description).toContain("There's nothing the repair can fix right now.");
    expect(embed.fields!.map(f => f.name)).toEqual(['Left for you (1)']);
    expect(view.components).toEqual([]);
  });

  test('an out-of-range page is clamped', () => {
    const view = renderPreview({ ...twoHundred(), page: 99 });
    expect(view.embeds[0].toJSON().footer?.text).toBe('Fixes to confirm: page 5 of 5');
  });
});

describe('emoji at a cut', () => {
  /** A UTF-16 high surrogate with no low surrogate after it: Discord rejects the whole payload. */
  const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

  test('a memory title with an emoji where the option description is cut keeps the emoji whole', () => {
    // "The post for the memory \"" is 25 characters, so the emoji straddles the 100-character limit.
    const title = `${'a'.repeat(73)}🐛 crash on startup`;
    const f = finding('memory.item.thread_missing', 1, {
      system: 'memory',
      repair: 'confirm',
      entity: 'MemoryItem',
      params: { title },
    });
    const view = renderPreview(state([f], [fixOf(f, 'confirm', { entity: 'MemoryItem' })]));
    const [option] = componentsOf(view)[0][0].options;
    expect(option.description.length).toBeLessThanOrEqual(100);
    expect(option.description).toEndWith('…');
    expect(loneSurrogate.test(option.description)).toBe(false);
    expect(loneSurrogate.test(JSON.stringify(view.embeds[0].toJSON()))).toBe(false);
  });

  test('labels and lines cut on an emoji keep it whole too', () => {
    const label = `${'b'.repeat(98)}🐛 and more`;
    const f = finding('core.staff_role.missing', 1, { repair: 'confirm' });
    const view = renderPreview(state([f], [fixOf(f, 'confirm', { label })]));
    const [option] = componentsOf(view)[0][0].options;
    expect(option.label.length).toBeLessThanOrEqual(100);
    expect(loneSurrogate.test(option.label)).toBe(false);
    expect(loneSurrogate.test(view.embeds[0].toJSON().description ?? '')).toBe(false);
  });
});

describe('optionText', () => {
  test('a menu option shows mentions as #id / @id and drops markdown', () => {
    expect(
      optionText('Post in <#300000000000000001>, ping <@&200000000000000001> or <@!400000000000000001>, **now** `x`'),
    ).toBe('Post in #300000000000000001, ping @200000000000000001 or @400000000000000001, now x');
  });

  test('a finding that names an existing role reads as @id in its option', () => {
    const f = finding('core.staff_role.format_legacy', 1, { repair: 'confirm' });
    const [option] = componentsOf(renderPreview(state([f], [fixOf(f, 'confirm')])))[0][0].options;
    expect(option.description).toContain('@200000000000000001');
    expect(option.description).not.toContain('<@&');
  });
});

describe('fitLines and parsePage', () => {
  test('lines that fit, then "…and N more", never over the limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${'z'.repeat(40)}`);
    const text = fitLines(lines, 300);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).toMatch(/…and 45 more$/);
    expect(fitLines(['a', 'b'], 300)).toBe('a\nb');
  });

  test('page buttons parse; anything else is not a page', () => {
    expect(parsePage(`${REPAIR_CID.page}3`)).toBe(3);
    expect(parsePage(`${REPAIR_CID.page}x`)).toBeNull();
    expect(parsePage(REPAIR_CID.apply)).toBeNull();
  });
});

describe('renderResults', () => {
  const step = (keys: string[]) => ({ keys }) as unknown as RepairStep;
  const result = (entries: [StepOutcome, number][]): RepairResult => ({
    results: entries.map(([outcome, fixes], i) => ({
      step: step(Array.from({ length: fixes }, (_, n) => `${i}-${n}`)),
      outcome,
    })),
    counts: {} as RepairResult['counts'],
  });

  test('fixes per bucket: applied, changed meanwhile, could not confirm deleted, failed', () => {
    const counts = resultCounts(
      result([
        ['applied', 3],
        ['stale', 1],
        ['gone', 1],
        ['exists', 1],
        ['skipped-not-missing', 1],
        ['skipped-unverified', 2],
        ['failed', 1],
      ]),
    );
    expect(counts).toEqual({ applied: 3, changed: 4, unverified: 2, failed: 1 });
  });

  test('the summary lines, a bug link for failures, then the new summary and "Preview remaining fixes"', () => {
    const remaining = finding('ticket.restriction.unknown_type', 1, { repair: 'confirm' });
    const next = state([remaining], [fixOf(remaining, 'confirm')]);
    const view = renderResults(
      result([
        ['applied', 2],
        ['stale', 1],
        ['skipped-unverified', 1],
        ['failed', 1],
      ]),
      next,
    );
    const [summary, health] = view.embeds.map(e => e.toJSON());
    expect(summary.title).toBe('Repair results');
    expect(summary.description).toContain('✅ Fixed: 2');
    expect(summary.description).toContain('Changed since the check, so left alone: 1');
    expect(summary.description).toContain("Couldn't confirm the channel, role or message is deleted, so left alone: 1");
    expect(summary.description).toContain('❌ Failed: 1');
    expect(summary.description).toContain('support server');
    expect(health.title).toBe('Server health');
    expect(health.footer?.text).toBe('/bot-health repair: 0 automatic, 1 to confirm, 0 to fix yourself');
    expect(view.components[0].toJSON().components[0]).toMatchObject({
      custom_id: REPAIR_CID.again,
      label: 'Preview remaining fixes',
    });
  });

  test('nothing left to fix: no button; the check afterwards failed: says so, no summary', () => {
    const clean = renderResults(result([['applied', 1]]), state([], []));
    expect(clean.embeds).toHaveLength(2);
    expect(clean.components).toEqual([]);
    const failed = renderResults(result([['applied', 1]]), null);
    expect(failed.embeds).toHaveLength(1);
    expect(failed.embeds[0].toJSON().description).toContain("The check afterwards couldn't finish");
    expect(failed.components).toEqual([]);
  });
});
