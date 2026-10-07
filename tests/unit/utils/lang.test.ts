/**
 * Locale machinery tests. English is the only shipped locale; the registry,
 * guild lookup and Proxy fallback stay so a partial translation can be dropped
 * in later. The fallback is exercised through `buildLocaleLang` with fake
 * partial modules, which is exactly what a registered translation goes through.
 *
 * Guild lookups use the AppDataSource runtime-patch pattern (not mock.module,
 * which is process-shared) so getGuildLocale reads a fake BotConfig row.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDashboardButtons } from '../../../src/commands/handlers/botSetup';
import {
  buildLocaleLang,
  DEFAULT_LOCALE,
  getGuildLang,
  getGuildLocale,
  getLangForLocale,
  getLocaleLabel,
  invalidateGuildLocaleCache,
  isSupportedLocale,
  lang,
  SUPPORTED_LOCALES,
} from '../../../src/lang';
import { AppDataSource } from '../../../src/typeorm';
import { DEFAULT_SYSTEM_STATES } from '../../../src/typeorm/entities/SetupState';

describe('SUPPORTED_LOCALES', () => {
  test('ships English only, as the default', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en']);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  test('every locale has a display label', () => {
    expect(getLocaleLabel('en')).toBe('English');
  });
});

describe('isSupportedLocale', () => {
  test('accepts known locale codes', () => {
    for (const code of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(code)).toBe(true);
    }
  });

  test('rejects the removed untranslated locales so stored values fall back to English', () => {
    for (const code of ['es', 'pt-BR', 'fr', 'de']) {
      expect(isSupportedLocale(code)).toBe(false);
    }
  });

  test('rejects unknown values', () => {
    expect(isSupportedLocale('jp')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });
});

describe('English modules (src/lang/en/index.ts)', () => {
  test('every JSON file in src/lang/en is registered under its file name', () => {
    const files = readdirSync(join(process.cwd(), 'src', 'lang', 'en'))
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -'.json'.length));
    expect(Object.keys(lang).sort()).toEqual(files.sort());
  });
});

describe('getLangForLocale', () => {
  test('returns the English singleton for "en" on every call', () => {
    expect(getLangForLocale('en')).toBe(lang);
    expect(getLangForLocale('en')).toBe(lang);
  });
});

describe('buildLocaleLang (partial translations)', () => {
  test('translated keys win; untranslated siblings fall back to English', () => {
    const es = buildLocaleLang({ ticket: { created: 'Tu ticket fue creado: ' } });
    expect(es.ticket.created).toBe('Tu ticket fue creado: ');
    expect(es.ticket.cancelled).toBe(lang.ticket.cancelled);
  });

  test('files the translation leaves out read entirely from English', () => {
    const es = buildLocaleLang({ ticket: { created: 'x' } });
    expect(es.general.cmdGuildNotFound).toBe(lang.general.cmdGuildNotFound);
    expect(es.botConfig.notFound).toBe(lang.botConfig.notFound);
  });

  test('an empty translation reads every file from English', () => {
    const empty = buildLocaleLang({});
    expect(empty.ticket.setup.createTicket).toBe(lang.ticket.setup.createTicket);
    expect(empty.roles.addRole.cmdDescrp).toBe(lang.roles.addRole.cmdDescrp);
  });

  test('a translated nested key wins; its siblings fall back to English', () => {
    const es = buildLocaleLang({ ticket: { setup: { createTicket: 'Crear ticket' } } });
    expect(es.ticket.setup.createTicket).toBe('Crear ticket');
    expect(es.ticket.setup.cmdDescrp).toBe(lang.ticket.setup.cmdDescrp);
  });

  test('array keys are replaced as whole arrays (no per-element fallback)', () => {
    const es = buildLocaleLang({ general: { presenceMessages: ['hola'] } });
    expect([...es.general.presenceMessages]).toEqual(['hola']);
    expect(Array.isArray(buildLocaleLang({}).general.presenceMessages)).toBe(true);
  });
});

describe('getGuildLocale / getGuildLang', () => {
  type PatchableDataSource = { isInitialized: boolean; getRepository: (e: unknown) => unknown };
  const ds = AppDataSource as unknown as PatchableDataSource;
  let original: Pick<PatchableDataSource, 'isInitialized' | 'getRepository'>;
  let storedLocale: string | null = null;

  beforeAll(() => {
    original = { isInitialized: ds.isInitialized, getRepository: ds.getRepository };
    ds.isInitialized = true;
    ds.getRepository = () => ({
      findOne: async ({ where }: { where: { guildId: string } }) =>
        storedLocale === null ? null : { guildId: where.guildId, locale: storedLocale },
    });
  });

  afterAll(() => {
    ds.isInitialized = original.isInitialized;
    ds.getRepository = original.getRepository;
    invalidateGuildLocaleCache();
  });

  beforeEach(() => invalidateGuildLocaleCache());

  test('a guild that picked a removed locale reads English (no migration needed)', async () => {
    for (const code of ['es', 'pt-BR', 'fr', 'de']) {
      storedLocale = code;
      invalidateGuildLocaleCache('g1');
      expect(await getGuildLocale('g1')).toBe('en');
      expect(await getGuildLang('g1')).toBe(lang);
    }
  });

  test('"en" and a missing BotConfig row both resolve to English', async () => {
    storedLocale = 'en';
    expect(await getGuildLocale('g2')).toBe('en');
    storedLocale = null;
    expect(await getGuildLocale('g3')).toBe('en');
  });
});

describe('/bot-setup Language button', () => {
  const buttonIds = (showLanguage?: boolean) =>
    buildDashboardButtons(DEFAULT_SYSTEM_STATES, null, showLanguage).components.map(
      b => (b.data as { custom_id?: string }).custom_id,
    );

  test('is hidden while English is the only locale', () => {
    expect(buttonIds()).not.toContain('setup_language');
    expect(buttonIds()).toEqual(['setup_finish_later', 'setup_manage_systems', 'setup_reset']);
  });

  test('comes back once there is a locale to choose', () => {
    expect(buttonIds(true)).toEqual(['setup_finish_later', 'setup_manage_systems', 'setup_language', 'setup_reset']);
  });
});
