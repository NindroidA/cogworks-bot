/**
 * Centralized language/translation system for the Cogworks Bot
 *
 * Strings live under `src/lang/<locale>/*.json`. English (`en`) is the base
 * locale and the only one shipped today. The machinery for more stays in
 * place: a translation is a PARTIAL set of JSON files registered in
 * `LOCALE_REGISTRY`, and a recursive Proxy falls back to English for every
 * file and key it leaves out (see `TRANSLATING.md`).
 *
 * The default `lang` export stays synchronously available and always resolves
 * to English — this preserves the existing `lang.x.y` access pattern used
 * throughout the codebase. For guild-scoped localization, call
 * `getGuildLang(guildId)` which reads the guild's configured locale from
 * BotConfig and returns a Proxy-wrapped `Language` object.
 *
 * Locale JSON files are **statically imported** (not `require`d) so that
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

import { createTtlCache } from '../utils/database/configCache';
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
import type { Language } from './types';

// ---------------------------------------------------------------------------
// Locale registry
// ---------------------------------------------------------------------------

/** English, the complete reference: one module per JSON file in `src/lang/en/`. */
const englishModules = {
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

/**
 * A locale's JSON modules. Every file is optional and typed as `unknown`: a
 * translation ships only the files it has translated, each holding only the
 * keys it has translated, and the Proxy fills in the rest from English.
 */
export type LocaleModules = { [File in keyof typeof englishModules]?: unknown };

interface LocaleDefinition {
  /** Native name shown in the /bot-setup Language picker. */
  label: string;
  modules: LocaleModules;
}

/**
 * Every locale the bot can display. Adding one is a single entry here plus its
 * partial JSON files, for example:
 *
 *   import ticketEs from './es/ticket.json';
 *   es: { label: 'Español', modules: { ticket: ticketEs } },
 *
 * The /bot-setup Language button appears once more than one locale exists.
 */
const LOCALE_REGISTRY = {
  en: { label: 'English', modules: englishModules },
} satisfies Record<string, LocaleDefinition>;

export type Locale = keyof typeof LOCALE_REGISTRY;

export const SUPPORTED_LOCALES = Object.keys(LOCALE_REGISTRY) as readonly Locale[];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Guards values read from BotConfig.locale. Codes for locales that are no
 * longer shipped (es, fr, de and pt-BR were removed in 3.16.19) fail this check,
 * so those guilds read English without a data migration.
 */
export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Native display name for a locale, e.g. 'English'. */
export function getLocaleLabel(locale: Locale): string {
  return LOCALE_REGISTRY[locale].label;
}

// ---------------------------------------------------------------------------
// Building a Language object from a set of JSON modules
// ---------------------------------------------------------------------------

function assembleLanguage(m: LocaleModules): Language {
  // Modules are `unknown` (a translation may diverge from or omit any file), so
  // each is cast to its English shape. Missing or divergent keys are filled in
  // by `withFallback` below; `?? {}` keeps a partial locale without ticket.json
  // or roles.json from throwing on the derived keys.
  const ticket = (m.ticket ?? {}) as typeof ticketEn;
  const roles = (m.roles ?? {}) as typeof rolesEn;
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

/**
 * Builds the `Language` for a (partial) set of translated modules: translated
 * keys win, every missing file or key reads English. Exported for tests.
 */
export function buildLocaleLang(modules: LocaleModules): Language {
  return withFallback(assembleLanguage(modules), englishLang);
}

// Seeded with English so `en` resolves to the plain `lang` object, not a Proxy.
const localeLangCache = new Map<Locale, Language>([[DEFAULT_LOCALE, englishLang]]);

/**
 * Returns the fully-resolved `Language` object for the given locale. The
 * result reads translated keys from the locale's JSON modules and falls back
 * to English for anything missing.
 *
 * Results are cached after first build — locale modules are static JSON.
 */
export function getLangForLocale(locale: Locale): Language {
  let resolved = localeLangCache.get(locale);
  if (!resolved) {
    resolved = buildLocaleLang(LOCALE_REGISTRY[locale].modules);
    localeLangCache.set(locale, resolved);
  }
  return resolved;
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
const guildLocaleCache = createTtlCache<string, Locale>(GUILD_LOCALE_TTL_MS);

export function invalidateGuildLocaleCache(guildId?: string): void {
  if (guildId) guildLocaleCache.invalidate(guildId);
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
  if (cached !== undefined) return cached;

  let locale: Locale = DEFAULT_LOCALE;
  try {
    const { AppDataSource } = await import('../typeorm');
    const { BotConfig } = await import('../typeorm/entities/BotConfig');
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(BotConfig);
      const config = await repo.findOne({ where: { guildId }, select: { guildId: true, locale: true } });
      if (config?.locale && isSupportedLocale(config.locale)) {
        locale = config.locale;
      }
    }
  } catch {
    // DB not ready or column missing (pre-migration) — default is safe.
  }

  guildLocaleCache.set(guildId, locale);
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
