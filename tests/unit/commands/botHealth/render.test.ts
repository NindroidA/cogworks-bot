/**
 * `/bot-health check` renderer: lang strings with named params, Discord's
 * embed limits (1024 per field, 25 fields, 6000 per embed) with a large
 * synthetic report, pagination, and the JSON export.
 */
import { describe, expect, test } from 'bun:test';
import type { APIEmbed } from 'discord.js';
import {
  buildExportAttachment,
  buildSummaryEmbed,
  fillTemplate,
  findingField,
  HEALTH_CID,
  paginateFindings,
  parseViewRequest,
  renderView,
} from '../../../../src/commands/handlers/botHealth/render';
import type { HealthFinding, HealthReport } from '../../../../src/utils/health/types';

const G = '100000000000000001';
const ROLE = '200000000000000001';

function finding(over: Partial<HealthFinding> = {}): HealthFinding {
  return {
    code: 'core.staff_role.missing',
    system: 'core',
    severity: 'cosmetic',
    repair: 'auto',
    entity: 'StaffRole',
    params: { roleId: ROLE, alias: 'Mods' },
    ...over,
  };
}

function report(over: Partial<HealthReport> = {}): HealthReport {
  return {
    guildId: G,
    botVersion: '3.16.25',
    checkedAt: '2026-10-06T12:00:00.000Z',
    deep: false,
    systems: { core: { status: 'ok', findings: [] } },
    counts: { auto: 0, confirm: 0, manual: 0 },
    notChecked: [],
    ...over,
  };
}

/** Everything Discord counts toward the 6000-character embed total. */
function embedLength(embed: APIEmbed): number {
  const fields = (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + fields;
}

/** 137 findings across two systems, some with parameters far over Discord's limits. */
function bigReport(): HealthReport {
  const huge = 'x'.repeat(3_000);
  const core = Array.from({ length: 90 }, (_, i) =>
    finding({ rowId: i, severity: i % 3 === 0 ? 'degraded' : 'cosmetic', params: { roleId: ROLE, alias: huge } }),
  );
  const tickets = Array.from({ length: 47 }, (_, i) =>
    finding({
      code: 'core.staff_role.unknown_type',
      system: 'ticket',
      severity: 'block',
      rowId: i,
      params: { type: 't' },
    }),
  );
  return report({
    systems: { core: { status: 'warn', findings: core }, ticket: { status: 'fail', findings: tickets } },
    counts: { auto: 137, confirm: 0, manual: 0 },
  });
}

describe('fillTemplate', () => {
  test('fills named params and leaves unknown ones as written', () => {
    expect(fillTemplate('{a} and {b} and {missing}', { a: 'x', b: 2 })).toBe('x and 2 and {missing}');
  });

  test('inherited object keys never fill a placeholder', () => {
    expect(fillTemplate('{constructor} {toString}', {})).toBe('{constructor} {toString}');
  });
});

describe('findingField', () => {
  test('a missing object is shown as its raw ID, an existing one as a mention', () => {
    expect(findingField(finding()).value).toContain(`(\`${ROLE}\`)`);
    expect(findingField(finding()).value).not.toContain(`<@&${ROLE}>`);
    const legacy = findingField(finding({ code: 'core.staff_role.format_legacy' }));
    expect(legacy.value).toContain(`<@&${ROLE}>`);
  });

  test('name carries severity and repair class; value ends with the stable code', () => {
    const field = findingField(finding({ severity: 'block', repair: 'manual' }));
    expect(field.name).toBe('❌ Broken · needs a manual fix');
    expect(field.value.endsWith('\n`core.staff_role.missing`')).toBe(true);
  });

  test('a code without a string falls back to the code itself', () => {
    expect(findingField(finding({ code: 'test.unknown' })).value).toStartWith('test.unknown');
  });

  test('an oversized value is cut to 1024 and still shows the code', () => {
    const field = findingField(finding({ params: { roleId: ROLE, alias: 'y'.repeat(5_000) } }));
    expect(field.value.length).toBe(1024);
    expect(field.value.endsWith('…\n`core.staff_role.missing`')).toBe(true);
  });
});

describe('paginateFindings', () => {
  test('a large report: every page within Discord limits, nothing lost, worst first', () => {
    const big = bigReport();
    for (const [system, result] of Object.entries(big.systems)) {
      const pages = paginateFindings(result!.findings);
      expect(pages.flat()).toHaveLength(result!.findings.length);
      pages.forEach((page, i) => {
        expect(page.length).toBeGreaterThan(0);
        expect(page.length).toBeLessThanOrEqual(10);
        for (const field of page) {
          expect(field.value.length).toBeLessThanOrEqual(1024);
          expect(field.name.length).toBeLessThanOrEqual(256);
        }
        const view = renderView(big, { kind: 'details', system, page: i });
        const embed = view.embeds[0].toJSON();
        expect(embed.fields?.length).toBeLessThanOrEqual(25);
        expect(embedLength(embed)).toBeLessThanOrEqual(6000);
      });
    }
    const core = paginateFindings(big.systems.core!.findings);
    expect(core.flat()[0].name).toStartWith('⚠️ Degraded');
    expect(core.flat().at(-1)!.name).toStartWith('💡 Cleanup');
  });

  test('short findings fill pages of 10', () => {
    const findings = Array.from({ length: 23 }, () => finding());
    expect(paginateFindings(findings).map(p => p.length)).toEqual([10, 10, 3]);
  });

  test('long findings get fewer per page so the embed stays under 6000', () => {
    const long = Array.from({ length: 10 }, () => finding({ params: { roleId: ROLE, alias: 'z'.repeat(2_000) } }));
    const pages = paginateFindings(long);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.reduce((n, f) => n + f.name.length + f.value.length, 0)).toBeLessThan(6000);
  });
});

describe('buildSummaryEmbed', () => {
  test('one line per system, counts in the footer, colour from the worst status', () => {
    const embed = buildSummaryEmbed(
      report({
        systems: {
          core: { status: 'warn', findings: [finding(), finding()] },
          ticket: { status: 'fail', findings: [finding({ severity: 'block' })] },
          memory: { status: 'not_configured', findings: [] },
          rules: { status: 'ok', findings: [] },
        },
        counts: { auto: 2, confirm: 1, manual: 0 },
      }),
    ).toJSON();
    const lines = embed.description!.split('\n');
    expect(lines[0]).toBe('Cogworks v3.16.25 · checked <t:1791288000:f>');
    expect(lines).toContain('⚠️ **Core (settings, roles, permissions, commands)**: 2 found');
    expect(lines).toContain('❌ **Tickets**: 1 found, something is broken');
    expect(lines).toContain('➖ **Memory**: not set up');
    expect(lines).toContain('✅ **Rules**: no problems');
    expect(embed.footer?.text).toBe('2 automatic · 1 need confirmation · 0 manual');
    expect(embed.color).toBe(0xed4245);
    expect(embed.title).toBe('Server health');
  });

  test('deep runs, other servers and notChecked are shown', () => {
    const embed = buildSummaryEmbed(report({ deep: true, notChecked: ['guild-cache-unavailable', 'rest:message:1'] }), {
      guildName: 'Other Server',
    }).toJSON();
    expect(embed.title).toBe('Server health: Other Server');
    expect(embed.description).toStartWith('Cogworks v3.16.25 · deep check');
    expect(embed.fields?.[0].name).toBe('Not checked');
    expect(embed.fields?.[0].value).toContain('`message:1`');
    expect(embed.fields?.[0].value).toContain('unavailable');
    expect(embed.color).toBe(0x57f287);
  });

  test('a system with no registered checks says so', () => {
    expect(buildSummaryEmbed(report({ systems: {} })).toJSON().description).toContain('no checks for this system yet');
  });
});

describe('renderView and parseViewRequest', () => {
  const big = bigReport();
  const ids = (view: ReturnType<typeof renderView>) =>
    view.components.flatMap(row => row.toJSON().components.map(c => ({ ...c }) as Record<string, any>));

  test('summary: a select of systems with findings, and Export JSON', () => {
    const components = ids(renderView(big, { kind: 'summary' }));
    const select = components.find(c => c.custom_id === HEALTH_CID.system)!;
    expect(select.options.map((o: { value: string }) => o.value)).toEqual(['core', 'ticket']);
    expect(components.some(c => c.custom_id === HEALTH_CID.export)).toBe(true);
  });

  test('summary with nothing found: no select, just Export JSON', () => {
    const components = ids(renderView(report(), { kind: 'summary' }));
    expect(components.map(c => c.custom_id)).toEqual([HEALTH_CID.export]);
  });

  test('details: page through with Previous/Next, bounds disabled, then back to the summary', () => {
    const pages = paginateFindings(big.systems.core!.findings).length;
    let view = parseViewRequest(HEALTH_CID.system, ['core'])!;
    expect(view).toEqual({ kind: 'details', system: 'core', page: 0 });

    for (let page = 0; page < pages; page++) {
      const rendered = renderView(big, view);
      expect(rendered.embeds[0].toJSON().footer?.text).toBe(`Page ${page + 1} of ${pages}`);
      const [prev, next] = ids(rendered).filter(c => c.custom_id?.startsWith(HEALTH_CID.page));
      expect(prev.disabled).toBe(page === 0);
      expect(next.disabled).toBe(page === pages - 1);
      if (page < pages - 1) view = parseViewRequest(next.custom_id)!;
    }
    expect(view).toEqual({ kind: 'details', system: 'core', page: pages - 1 });
    expect(parseViewRequest(HEALTH_CID.summary)).toEqual({ kind: 'summary' });
  });

  test('an out-of-range page is clamped; a system with nothing found shows the summary', () => {
    const last = renderView(big, { kind: 'details', system: 'ticket', page: 99 });
    expect(last.embeds[0].toJSON().footer?.text).toBe('Page 5 of 5');
    const none = renderView(big, { kind: 'details', system: 'memory', page: 0 });
    expect(none.embeds[0].toJSON().title).toBe('Server health');
  });

  test('unknown or malformed custom ids are not views', () => {
    expect(parseViewRequest(HEALTH_CID.export)).toBeNull();
    expect(parseViewRequest(`${HEALTH_CID.page}core:abc`)).toBeNull();
    expect(parseViewRequest(HEALTH_CID.system, [])).toBeNull();
  });
});

describe('buildExportAttachment', () => {
  test('the full report as JSON, named after the guild', () => {
    const big = bigReport();
    const file = buildExportAttachment(big);
    expect(file.name).toBe(`bot-health-${G}-2026-10-06T12-00-00-000Z.json`);
    expect(JSON.parse((file.attachment as Buffer).toString('utf8'))).toEqual(big);
  });
});
