/**
 * Centralized language/translation system for the Cogworks Bot
 *
 * Strings live under `src/lang/<locale>/*.json`. English (`en`) is the base
 * locale; every other locale falls back to English for missing keys via a
 * recursive Proxy.
 *
 * The default `lang` export stays synchronously available and always resolves
 * to English — this preserves the existing `lang.x.y` access pattern used
 * throughout the codebase. For guild-scoped localization, call
 * `getGuildLang(guildId)` which reads the guild's configured locale from
 * BotConfig and returns a Proxy-wrapped `Language` object.
 *
 * Non-English JSON files are **statically imported** (not `require`d) so that
 * `tsc` copies them into `dist/` for containerized production deploys.
 *
 * @example
 * ```typescript
 * import { lang, getGuildLang } from './lang';
 *
 * // Synchronous English access (unchanged)
 * console.log(lang.general.cmdGuildNotFound);
 *
 * // Locale-aware access for a specific guild
 * const glang = await getGuildLang(guildId);
 * console.log(glang.ticket.created);
 * ```
 */

import analyticsDe from './de/analytics.json';
import announcementDe from './de/announcement.json';
import applicationDe from './de/application.json';
import automodDe from './de/automod.json';
import baitChannelDe from './de/baitChannel.json';
import botConfigDe from './de/botConfig.json';
import botSetupDe from './de/botSetup.json';
import consoleDe from './de/console.json';
import dataExportDe from './de/dataExport.json';
import devDe from './de/dev.json';
import errorsDe from './de/errors.json';
import eventDe from './de/event.json';
import generalDe from './de/general.json';
import importDe from './de/import.json';
import mainDe from './de/main.json';
import memoryDe from './de/memory.json';
import onboardingDe from './de/onboarding.json';
import reactionRoleDe from './de/reactionRole.json';
import rolesDe from './de/roles.json';
import rulesDe from './de/rules.json';
import starboardDe from './de/starboard.json';
import statusDe from './de/status.json';
import ticketDe from './de/ticket.json';
import xpDe from './de/xp.json';
// --- English (reference) ---
import analyticsEn from './en/analytics.json';
import announcementEn from './en/announcement.json';
import applicationEn from './en/application.json';
import automodEn from './en/automod.json';
import baitChannelEn from './en/baitChannel.json';
import botConfigEn from './en/botConfig.json';
import botSetupEn from './en/botSetup.json';
import consoleEn from './en/console.json';
import dataExportEn from './en/dataExport.json';
import devEn from './en/dev.json';
import errorsEn from './en/errors.json';
import eventEn from './en/event.json';
import generalEn from './en/general.json';
import importEn from './en/import.json';
import mainEn from './en/main.json';
import memoryEn from './en/memory.json';
import onboardingEn from './en/onboarding.json';
import reactionRoleEn from './en/reactionRole.json';
import rolesEn from './en/roles.json';
import rulesEn from './en/rules.json';
import starboardEn from './en/starboard.json';
import statusEn from './en/status.json';
import ticketEn from './en/ticket.json';
import xpEn from './en/xp.json';
// --- Other locales (scaffolded; may be partially translated) ---
// Imported as `unknown` so they're free to diverge from EN in shape while the
// Proxy fills in any missing keys at read time.
import analyticsEs from './es/analytics.json';
import announcementEs from './es/announcement.json';
import applicationEs from './es/application.json';
import automodEs from './es/automod.json';
import baitChannelEs from './es/baitChannel.json';
import botConfigEs from './es/botConfig.json';
import botSetupEs from './es/botSetup.json';
import consoleEs from './es/console.json';
import dataExportEs from './es/dataExport.json';
import devEs from './es/dev.json';
import errorsEs from './es/errors.json';
import eventEs from './es/event.json';
import generalEs from './es/general.json';
import importEs from './es/import.json';
import mainEs from './es/main.json';
import memoryEs from './es/memory.json';
import onboardingEs from './es/onboarding.json';
import reactionRoleEs from './es/reactionRole.json';
import rolesEs from './es/roles.json';
import rulesEs from './es/rules.json';
import starboardEs from './es/starboard.json';
import statusEs from './es/status.json';
import ticketEs from './es/ticket.json';
import xpEs from './es/xp.json';

import analyticsFr from './fr/analytics.json';
import announcementFr from './fr/announcement.json';
import applicationFr from './fr/application.json';
import automodFr from './fr/automod.json';
import baitChannelFr from './fr/baitChannel.json';
import botConfigFr from './fr/botConfig.json';
import botSetupFr from './fr/botSetup.json';
import consoleFr from './fr/console.json';
import dataExportFr from './fr/dataExport.json';
import devFr from './fr/dev.json';
import errorsFr from './fr/errors.json';
import eventFr from './fr/event.json';
import generalFr from './fr/general.json';
import importFr from './fr/import.json';
import mainFr from './fr/main.json';
import memoryFr from './fr/memory.json';
import onboardingFr from './fr/onboarding.json';
import reactionRoleFr from './fr/reactionRole.json';
import rolesFr from './fr/roles.json';
import rulesFr from './fr/rules.json';
import starboardFr from './fr/starboard.json';
import statusFr from './fr/status.json';
import ticketFr from './fr/ticket.json';
import xpFr from './fr/xp.json';
import analyticsPt from './pt-BR/analytics.json';
import announcementPt from './pt-BR/announcement.json';
import applicationPt from './pt-BR/application.json';
import automodPt from './pt-BR/automod.json';
import baitChannelPt from './pt-BR/baitChannel.json';
import botConfigPt from './pt-BR/botConfig.json';
import botSetupPt from './pt-BR/botSetup.json';
import consolePt from './pt-BR/console.json';
import dataExportPt from './pt-BR/dataExport.json';
import devPt from './pt-BR/dev.json';
import errorsPt from './pt-BR/errors.json';
import eventPt from './pt-BR/event.json';
import generalPt from './pt-BR/general.json';
import importPt from './pt-BR/import.json';
import mainPt from './pt-BR/main.json';
import memoryPt from './pt-BR/memory.json';
import onboardingPt from './pt-BR/onboarding.json';
import reactionRolePt from './pt-BR/reactionRole.json';
import rolesPt from './pt-BR/roles.json';
import rulesPt from './pt-BR/rules.json';
import starboardPt from './pt-BR/starboard.json';
import statusPt from './pt-BR/status.json';
import ticketPt from './pt-BR/ticket.json';
import xpPt from './pt-BR/xp.json';

import type { Language } from './types';

// ---------------------------------------------------------------------------
// Supported locales
// ---------------------------------------------------------------------------

/**
 * The set of locales the bot can display. Adding a new locale requires:
 *   1) adding its directory under `src/lang/<code>/` with the 24 JSON files
 *   2) adding the static imports above
 *   3) adding the code to this list + to `LOCALE_MODULES`
 *   4) adding a label in `LOCALE_LABELS` in `commands/handlers/botSetup/index.ts`
 */
export const SUPPORTED_LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Building a Language object from a set of JSON modules
// ---------------------------------------------------------------------------

/**
 * Raw JSON modules for a locale. Any/all fields are optional — missing keys
 * fall back to English via the Proxy wrapper. Typed as `unknown` so partial
 * translations compile even if keys shift between locales.
 */
interface LocaleModules {
  analytics: unknown;
  announcement: unknown;
  application: unknown;
  automod: unknown;
  baitChannel: unknown;
  botConfig: unknown;
  botSetup: unknown;
  console: unknown;
  dataExport: unknown;
  dev: unknown;
  errors: unknown;
  event: unknown;
  general: unknown;
  import: unknown;
  main: unknown;
  memory: unknown;
  onboarding: unknown;
  reactionRole: unknown;
  roles: unknown;
  rules: unknown;
  starboard: unknown;
  status: unknown;
  ticket: unknown;
  xp: unknown;
}

const englishModules: LocaleModules = {
  analytics: analyticsEn,
  announcement: announcementEn,
  application: applicationEn,
  automod: automodEn,
  baitChannel: baitChannelEn,
  botConfig: botConfigEn,
  botSetup: botSetupEn,
  console: consoleEn,
  dataExport: dataExportEn,
  dev: devEn,
  errors: errorsEn,
  event: eventEn,
  general: generalEn,
  import: importEn,
  main: mainEn,
  memory: memoryEn,
  onboarding: onboardingEn,
  reactionRole: reactionRoleEn,
  roles: rolesEn,
  rules: rulesEn,
  starboard: starboardEn,
  status: statusEn,
  ticket: ticketEn,
  xp: xpEn,
};

const LOCALE_MODULES: Record<Locale, LocaleModules> = {
  en: englishModules,
  es: {
    analytics: analyticsEs,
    announcement: announcementEs,
    application: applicationEs,
    automod: automodEs,
    baitChannel: baitChannelEs,
    botConfig: botConfigEs,
    botSetup: botSetupEs,
    console: consoleEs,
    dataExport: dataExportEs,
    dev: devEs,
    errors: errorsEs,
    event: eventEs,
    general: generalEs,
    import: importEs,
    main: mainEs,
    memory: memoryEs,
    onboarding: onboardingEs,
    reactionRole: reactionRoleEs,
    roles: rolesEs,
    rules: rulesEs,
    starboard: starboardEs,
    status: statusEs,
    ticket: ticketEs,
    xp: xpEs,
  },
  'pt-BR': {
    analytics: analyticsPt,
    announcement: announcementPt,
    application: applicationPt,
    automod: automodPt,
    baitChannel: baitChannelPt,
    botConfig: botConfigPt,
    botSetup: botSetupPt,
    console: consolePt,
    dataExport: dataExportPt,
    dev: devPt,
    errors: errorsPt,
    event: eventPt,
    general: generalPt,
    import: importPt,
    main: mainPt,
    memory: memoryPt,
    onboarding: onboardingPt,
    reactionRole: reactionRolePt,
    roles: rolesPt,
    rules: rulesPt,
    starboard: starboardPt,
    status: statusPt,
    ticket: ticketPt,
    xp: xpPt,
  },
  fr: {
    analytics: analyticsFr,
    announcement: announcementFr,
    application: applicationFr,
    automod: automodFr,
    baitChannel: baitChannelFr,
    botConfig: botConfigFr,
    botSetup: botSetupFr,
    console: consoleFr,
    dataExport: dataExportFr,
    dev: devFr,
    errors: errorsFr,
    event: eventFr,
    general: generalFr,
    import: importFr,
    main: mainFr,
    memory: memoryFr,
    onboarding: onboardingFr,
    reactionRole: reactionRoleFr,
    roles: rolesFr,
    rules: rulesFr,
    starboard: starboardFr,
    status: statusFr,
    ticket: ticketFr,
    xp: xpFr,
  },
  de: {
    analytics: analyticsDe,
    announcement: announcementDe,
    application: applicationDe,
    automod: automodDe,
    baitChannel: baitChannelDe,
    botConfig: botConfigDe,
    botSetup: botSetupDe,
    console: consoleDe,
    dataExport: dataExportDe,
    dev: devDe,
    errors: errorsDe,
    event: eventDe,
    general: generalDe,
    import: importDe,
    main: mainDe,
    memory: memoryDe,
    onboarding: onboardingDe,
    reactionRole: reactionRoleDe,
    roles: rolesDe,
    rules: rulesDe,
    starboard: starboardDe,
    status: statusDe,
    ticket: ticketDe,
    xp: xpDe,
  },
};

function assembleLanguage(m: LocaleModules): Language {
  // English is fully typed; other locales cast through `unknown`. Missing or
  // divergent keys are filled in by `withFallback` below.
  const ticket = m.ticket as typeof ticketEn;
  const roles = m.roles as typeof rolesEn;
  return {
    general: m.general as typeof generalEn,
    main: m.main as typeof mainEn,
    console: m.console as typeof consoleEn,
    botConfig: m.botConfig as typeof botConfigEn,
    botSetup: m.botSetup as typeof botSetupEn,
    ticket,
    ticketSetup: ticket.setup,
    application: m.application as typeof applicationEn,
    addRole: roles.addRole,
    removeRole: roles.removeRole,
    getRoles: roles.getRoles,
    cogdeck: {
      cmdDescrp: 'Base command for the Cogworks Card Game',
    },
    announcement: m.announcement as typeof announcementEn,
    baitChannel: m.baitChannel as typeof baitChannelEn,
    dataExport: m.dataExport as typeof dataExportEn,
    errors: m.errors as typeof errorsEn,
    dev: m.dev as typeof devEn,
    memory: m.memory as typeof memoryEn,
    rules: m.rules as typeof rulesEn,
    reactionRole: m.reactionRole as typeof reactionRoleEn,
    starboard: m.starboard as typeof starboardEn,
    status: m.status as typeof statusEn,
    import: m.import as typeof importEn,
    xp: m.xp as typeof xpEn,
    onboarding: m.onboarding as typeof onboardingEn,
    automod: m.automod as typeof automodEn,
    event: m.event as typeof eventEn,
    analytics: m.analytics as typeof analyticsEn,
  };
}

// ---------------------------------------------------------------------------
// English — the base/fallback locale, synchronously available
// ---------------------------------------------------------------------------

const englishLang: Language = assembleLanguage(englishModules);

/**
 * Complete English language object with type safety.
 * Access via `lang.<module>.<key>`.
 *
 * This is the synchronous default and is what every non-localized call site
 * uses today. Existing code does not need to change.
 */
export const lang: Language = englishLang;

// ---------------------------------------------------------------------------
// Proxy-based fallback: any locale → falls back to English for missing keys
// ---------------------------------------------------------------------------

/**
 * Wraps `target` so that missing (undefined/null) keys transparently fall back
 * to the corresponding key in `fallback`, recursively for nested objects.
 *
 * Arrays are returned as-is (no per-element fallback) — arrays in the Language
 * schema represent whole ordered lists (e.g. `general.presenceMessages`) where
 * a translator would replace the full list.
 */
function withFallback<T extends object>(target: Partial<T>, fallback: T): T {
  return new Proxy(target as T, {
    get(_t, prop, receiver) {
      const value = Reflect.get(target as object, prop, receiver);
      const fallbackValue = Reflect.get(fallback as object, prop, receiver);

      if (value === undefined || value === null) return fallbackValue;
      if (Array.isArray(value)) return value;

      if (typeof value === 'object' && typeof fallbackValue === 'object' && fallbackValue !== null) {
        return withFallback(value as object, fallbackValue as object);
      }
      return value;
    },
    has(_t, prop) {
      return prop in (target as object) || prop in (fallback as object);
    },
    ownKeys() {
      return Array.from(new Set([...Reflect.ownKeys(fallback as object), ...Reflect.ownKeys(target as object)]));
    },
    getOwnPropertyDescriptor(_t, prop) {
      return (
        Reflect.getOwnPropertyDescriptor(target as object, prop) ??
        Reflect.getOwnPropertyDescriptor(fallback as object, prop)
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Locale → Language resolution (cached)
// ---------------------------------------------------------------------------

const localeLangCache = new Map<Locale, Language>();

/**
 * Returns the fully-resolved `Language` object for the given locale. The
 * result reads translated keys from the locale's JSON modules and falls back
 * to English for anything missing.
 *
 * Results are cached after first build — locale modules are static JSON.
 */
export function getLangForLocale(locale: Locale): Language {
  const cached = localeLangCache.get(locale);
  if (cached) return cached;

  if (locale === 'en') {
    localeLangCache.set(locale, englishLang);
    return englishLang;
  }

  const modules = LOCALE_MODULES[locale];
  const partial = assembleLanguage(modules);
  const wrapped = withFallback(partial, englishLang);
  localeLangCache.set(locale, wrapped);
  return wrapped;
}

// ---------------------------------------------------------------------------
// Guild-scoped resolution
// ---------------------------------------------------------------------------

/**
 * Cache of guildId → locale, with a short TTL so dashboard-driven updates
 * propagate without requiring a process restart. The setup handler calls
 * `invalidateGuildLocaleCache(guildId)` when it persists a change so users
 * see the update immediately rather than waiting for TTL expiry.
 */
const GUILD_LOCALE_TTL_MS = 5 * 60 * 1000;
const guildLocaleCache = new Map<string, { locale: Locale; expires: number }>();

export function invalidateGuildLocaleCache(guildId?: string): void {
  if (guildId) guildLocaleCache.delete(guildId);
  else guildLocaleCache.clear();
}

/**
 * Resolve the configured locale for a guild from BotConfig. Falls back to
 * `DEFAULT_LOCALE` if the guild has no config row, an unsupported value, or
 * if the database is unreachable — lang lookups must never throw.
 *
 * BotConfig/AppDataSource are imported lazily to avoid an import cycle.
 */
export async function getGuildLocale(guildId: string): Promise<Locale> {
  const cached = guildLocaleCache.get(guildId);
  if (cached && cached.expires > Date.now()) return cached.locale;

  let locale: Locale = DEFAULT_LOCALE;
  try {
    const { AppDataSource } = await import('../typeorm');
    const { BotConfig } = await import('../typeorm/entities/BotConfig');
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(BotConfig);
      const config = await repo.findOne({ where: { guildId }, select: ['guildId', 'locale'] });
      if (config?.locale && isSupportedLocale(config.locale)) {
        locale = config.locale;
      }
    }
  } catch {
    // DB not ready or column missing (pre-migration) — default is safe.
  }

  guildLocaleCache.set(guildId, { locale, expires: Date.now() + GUILD_LOCALE_TTL_MS });
  return locale;
}

/**
 * Returns the `Language` object for the given guild's configured locale.
 * Missing keys transparently fall back to English.
 */
export async function getGuildLang(guildId: string): Promise<Language> {
  const locale = await getGuildLocale(guildId);
  return getLangForLocale(locale);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { LangApplication, LangConsole, LangGeneral, LangMain, LangTicket, Language } from './types';

export default lang;
