/**
 * `/bot-health check` renderer: lang strings with named params, Discord's
 * embed limits (1024 per field, 25 fields, 6000 per embed) with a large
 * synthetic report, pagination, the marks and counts for what
 * `/bot-health repair` can fix, and the JSON export.
 */
import { describe, expect, test } from 'bun:test';
import type { APIEmbed } from 'discord.js';
import {
  buildExportAttachment,
  buildSummaryEmbed,
  exportParams,
  findingField,
  HEALTH_CID,
  paginateFindings,
  parseViewRequest,
  renderView,
  truncate,
} from '../../../../src/commands/handlers/botHealth/render';
import { findingKey } from '../../../../src/utils/health/repair/keys';
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

describe('findingField', () => {
  test('a missing object is shown as its raw ID, an existing one as a mention', () => {
    expect(findingField(finding()).value).toContain(`(\`${ROLE}\`)`);
    expect(findingField(finding()).value).not.toContain(`<@&${ROLE}>`);
    const legacy = findingField(finding({ code: 'core.staff_role.format_legacy' }));
    expect(legacy.value).toContain(`<@&${ROLE}>`);
  });

  test('name carries the severity only; value ends with the stable code', () => {
    const field = findingField(finding({ severity: 'block', repair: 'manual' }));
    expect(field.name).toBe('❌ Broken');
    expect(field.value.endsWith('\n`core.staff_role.missing`')).toBe(true);
    expect(field.value).not.toContain('/bot-health repair');
  });

  test('the repair class alone never shows: only a fix the plan has is marked (the class stays in the export)', () => {
    const text = `The saved role "Mods" (\`${ROLE}\`) was deleted. New ticket channels skip it. No action is needed.`;
    const fields = (['auto', 'confirm', 'manual'] as const).map(repair => findingField(finding({ repair })));
    for (const field of fields) {
      expect(field.value).toBe(`${text}\n\`core.staff_role.missing\``);
      expect(`${field.name} ${field.value}`).not.toMatch(/repair|automatic|coming soon/i);
    }
    expect(findingField(finding(), 'auto').value).toBe(
      `${text}\n🔧 \`/bot-health repair\` can fix this.\n\`core.staff_role.missing\``,
    );
    expect(findingField(finding(), 'confirm').value).toContain(
      'can fix this once you confirm it.\n`core.staff_role.missing`',
    );
  });

  test('a code without a string falls back to the code itself', () => {
    expect(findingField(finding({ code: 'test.unknown' })).value).toStartWith('test.unknown');
  });

  test('truncate cuts on code points: an emoji at the limit is dropped whole, never split', () => {
    const cut = truncate(`${'a'.repeat(98)}🐛tail`, 100);
    expect(cut).toBe(`${'a'.repeat(98)}…`);
    expect(truncate('short', 100)).toBe('short');
    expect(truncate('x'.repeat(101), 100)).toBe(`${'x'.repeat(99)}…`);
  });

  test('an oversized value is cut to 1024 and still shows the code (and the fix mark)', () => {
    const field = findingField(finding({ params: { roleId: ROLE, alias: 'y'.repeat(5_000) } }));
    expect(field.value.length).toBe(1024);
    expect(field.value.endsWith('…\n`core.staff_role.missing`')).toBe(true);
    const marked = findingField(finding({ params: { roleId: ROLE, alias: 'y'.repeat(5_000) } }), 'confirm');
    expect(marked.value.length).toBe(1024);
    expect(marked.value.endsWith('confirm it.\n`core.staff_role.missing`')).toBe(true);
  });
});

describe('paginateFindings', () => {
  test('a large report, every finding marked fixable: every page within Discord limits, nothing lost, worst first', () => {
    const big = bigReport();
    const fixable = new Map(
      Object.values(big.systems).flatMap(r => r!.findings.map(f => [findingKey(f), 'confirm'] as const)),
    );
    for (const [system, result] of Object.entries(big.systems)) {
      const pages = paginateFindings(result!.findings, fixable);
      expect(pages.flat()).toHaveLength(result!.findings.length);
      pages.forEach((page, i) => {
        expect(page.length).toBeGreaterThan(0);
        expect(page.length).toBeLessThanOrEqual(10);
        for (const field of page) {
          expect(field.value.length).toBeLessThanOrEqual(1024);
          expect(field.name.length).toBeLessThanOrEqual(256);
        }
        const view = renderView(big, { kind: 'details', system, page: i }, { fixable });
        const embed = view.embeds[0].toJSON();
        expect(embed.fields?.map(f => f.value)).toEqual(page.map(f => f.value));
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
  test('one line per system, colour from the worst status', () => {
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
    expect(lines).toContain('⚠️ **Core (settings, staff roles, permissions, commands)**: 2 found');
    expect(lines).toContain('❌ **Tickets**: 1 found, something is broken');
    expect(lines).toContain('➖ **Memory**: not set up');
    expect(lines).toContain('✅ **Rules**: no problems');
    expect(embed.color).toBe(0xed4245);
    expect(embed.title).toBe('Server health');
  });

  test('the footer counts what the repair can fix (each distinct finding once); the class alone counts as manual', () => {
    const auto = finding({ rowId: 1 });
    const confirm = finding({ rowId: 2, repair: 'confirm' });
    const r = report({
      systems: {
        core: { status: 'warn', findings: [auto, auto, confirm, finding({ rowId: 3 })] },
        ticket: { status: 'fail', findings: [finding({ rowId: 4, repair: 'manual', severity: 'block' })] },
      },
    });
    const fixable = new Map([
      [findingKey(auto), 'auto' as const],
      [findingKey(confirm), 'confirm' as const],
    ]);
    expect(buildSummaryEmbed(r, { fixable }).toJSON().footer?.text).toBe(
      '/bot-health repair: 1 automatic, 1 to confirm, 2 to fix yourself',
    );
    expect(buildSummaryEmbed(r).toJSON().footer?.text).toBe(
      '/bot-health repair: 0 automatic, 0 to confirm, 4 to fix yourself',
    );
  });

  test('no footer for a clean report', () => {
    expect(buildSummaryEmbed(report()).toJSON().footer).toBeUndefined();
    const countsOnly = report({ counts: { auto: 0, confirm: 0, manual: 3 } });
    expect(buildSummaryEmbed(countsOnly).toJSON().footer).toBeUndefined();
  });

  test('deep runs, other servers and notChecked are shown', () => {
    const embed = buildSummaryEmbed(report({ deep: true, notChecked: ['guild-cache-unavailable', 'rest:message:1'] }), {
      guildName: 'Other Server',
    }).toJSON();
    expect(embed.title).toBe('Server health: Other Server');
    expect(embed.description).toStartWith('Cogworks v3.16.25 · deep check');
    expect(embed.fields?.[0].name).toBe('Not checked');
    // An unknown label is shown as is.
    expect(embed.fields?.[0].value).toContain('message:1: not all were looked up');
    expect(embed.fields?.[0].value).toContain('unavailable');
    expect(embed.color).toBe(0x57f287);
  });

  test('skipped lookups: readable labels, the fixed caps, and no "try again later"', () => {
    const labels = ['rest:memory.thread', 'rest:rules.message', 'rest:TicketConfig.messageId', 'rest:guild emojis'];
    const value = buildSummaryEmbed(report({ deep: true, notChecked: labels })).toJSON().fields?.[0].value ?? '';
    expect(value).toContain('Memory posts: not all were looked up');
    expect(value).toContain('The rules message:');
    expect(value).toContain('The ticket panel message:');
    expect(value).toContain("This server's emojis:");
    expect(value).toContain('at most 60 Discord lookups');
    expect(value).toContain('at most 20 memory posts');
    expect(value).toContain('skips the same ones');
    expect(value).not.toMatch(/later|memory\.thread|rules\.message|TicketConfig/);
  });

  test('a check of all systems names the ones without checks yet', () => {
    const embed = buildSummaryEmbed(report(), { notCheckedYet: ['baitchannel'] }).toJSON();
    expect(embed.description?.split('\n')).toContain('➖ **Bait channel**: not checked yet');
    expect(embed.description).not.toContain('no checks for this system yet');
    // A system that is in the report isn't listed twice.
    const listed = buildSummaryEmbed(report(), { notCheckedYet: ['core'] }).toJSON().description ?? '';
    expect(listed).not.toContain('not checked yet');
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
  const exported = (r: HealthReport) => JSON.parse((buildExportAttachment(r).attachment as Buffer).toString('utf8'));

  test('the full report as JSON, named after the guild, with free-text params dropped', () => {
    const big = bigReport();
    const file = buildExportAttachment(big);
    expect(file.name).toBe(`bot-health-${G}-2026-10-06T12-00-00-000Z.json`);
    const json = exported(big);
    // Only the role id survives: `alias` and the ticket findings' `type` are text.
    const strip = (findings: HealthFinding[]) =>
      findings.map(f => ({
        ...f,
        params: Object.fromEntries(Object.entries(f.params).filter(([k]) => k === 'roleId')),
      }));
    expect(json).toEqual({
      ...big,
      systems: {
        core: { ...big.systems.core, findings: strip(big.systems.core!.findings) },
        ticket: { ...big.systems.ticket, findings: strip(big.systems.ticket!.findings) },
      },
    });
  });

  test('IDs, codes and numbers only: names, titles, aliases and labels never leave the server', () => {
    const params = {
      name: 'secret-staff-channel',
      title: 'My private memory',
      alias: 'Mods',
      label: 'What is your address?',
      emoji: '<:secret:123456789012345678>',
      typeId: 'private_type',
      keptName: 'Ideas',
      roleId: ROLE,
      channelId: '300000000000000001',
      count: 26,
      permissions: 'SendMessages, ReadMessageHistory',
    };
    const r = report({
      systems: { core: { status: 'warn', findings: [finding({ params, rowId: 7, refId: ROLE })] } },
      counts: { auto: 1, confirm: 0, manual: 0 },
    });
    const [f] = exported(r).systems.core.findings;
    expect(f.params).toEqual({
      roleId: ROLE,
      channelId: '300000000000000001',
      count: 26,
      permissions: 'SendMessages, ReadMessageHistory',
    });
    expect(f).toMatchObject({ code: 'core.staff_role.missing', rowId: 7, refId: ROLE, repair: 'auto' });
    const text = JSON.stringify(exported(r));
    for (const secret of ['secret', 'private', 'Mods', 'address', 'Ideas']) expect(text).not.toContain(secret);
    expect(exportParams({ name: '12345' })).toEqual({});
  });
});
