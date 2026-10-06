/**
 * Per-guild module-gated command visibility.
 *
 * A module's slash/context-menu commands are hidden from a guild's command
 * picker when that module is disabled in the guild. Commands are registered
 * per-guild (see index.ts / guildCreate.ts), so we simply register a filtered
 * subset and re-register (debounced) whenever a module is toggled.
 *
 * IMPORTANT — only gate modules that have an ALWAYS-VISIBLE re-enable path.
 * A module is listed in {@link COMMAND_MODULE} only when, after being hidden,
 * an admin can still turn it back on:
 *   - tickets/applications/announcements/memory/xp → separate `*-setup`
 *     command (never gated, always visible).
 *   - baitchannel → the always-visible `/bot-setup` dashboard.
 * Single-command toggle modules whose only setup path is a subcommand of the
 * command itself (starboard, event, onboarding, analytics, reactionrole) and
 * automod (no DB config at all) are intentionally NOT gated — hiding them
 * would strand admins with no way to re-enable. Add a module here only once it
 * gains a guaranteed always-visible re-enable path.
 */

import { Routes } from 'discord.js';
import { AnnouncementConfig } from '../../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import { MemoryConfig } from '../../typeorm/entities/memory/MemoryConfig';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { XPConfig } from '../../typeorm/entities/xp/XPConfig';
import { lazyRepo } from '../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { getClientId, getRest } from '../restClient';

/** Modules whose commands are hidden when the module is disabled. */
export type GatedModule = 'tickets' | 'applications' | 'announcements' | 'memory' | 'xp' | 'baitchannel';

/**
 * Command/context-menu name → the gated module it belongs to. Any command NOT
 * in this map is ALWAYS visible (fail-safe): meta commands, every `*-setup`
 * command, and the non-gated modules above.
 */
const COMMAND_MODULE: Record<string, GatedModule> = {
  // tickets — re-enable via /ticket-setup (always visible)
  ticket: 'tickets',
  'Open Ticket For User': 'tickets',
  'Manage Restrictions': 'tickets',
  // applications — re-enable via /application-setup
  application: 'applications',
  // announcements — re-enable via /announcement-setup
  announcement: 'announcements',
  // memory — re-enable via /memory-setup
  memory: 'memory',
  'Capture to Memory': 'memory',
  // xp — re-enable via /xp-setup
  rank: 'xp',
  leaderboard: 'xp',
  xp: 'xp',
  // baitchannel — re-enable via the always-visible /bot-setup dashboard
  baitchannel: 'baitchannel',
  'View Bait Score': 'baitchannel',
};

const ticketConfigRepo = lazyRepo(TicketConfig);
const applicationConfigRepo = lazyRepo(ApplicationConfig);
const announcementConfigRepo = lazyRepo(AnnouncementConfig);
const memoryConfigRepo = lazyRepo(MemoryConfig);
const xpConfigRepo = lazyRepo(XPConfig);
const baitConfigRepo = lazyRepo(BaitChannelConfig);

/** Debounce window so a burst of toggles coalesces into one re-registration. */
const REFRESH_DEBOUNCE_MS = 3_000;

const pendingRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** guildId → signature of the module set last registered, to skip no-op PUTs. */
const lastRegisteredSignature = new Map<string, string>();

/** Extract a command's registered name from a builder or plain command object. */
function commandName(cmd: unknown): string | undefined {
  const c = cmd as { toJSON?: () => { name: string }; name?: string };
  return typeof c.toJSON === 'function' ? c.toJSON().name : c.name;
}

/**
 * Resolve which gated modules are ENABLED (functional) in a guild.
 *
 * The "enabled" signal is heterogeneous:
 *   - xp / baitchannel have an explicit `enabled` boolean (XP defaults false,
 *     bait defaults true but its row only exists once a channel is configured).
 *   - tickets/applications/announcements/memory have NO boolean — the config
 *     row only exists once set up, so row-existence IS the enable signal.
 */
export async function getEnabledGatedModules(guildId: string): Promise<Set<GatedModule>> {
  const [ticketCfg, appCfg, annCfg, memCfg, xpCfg, baitCfg] = await Promise.all([
    ticketConfigRepo.findOneBy({ guildId }),
    applicationConfigRepo.findOneBy({ guildId }),
    announcementConfigRepo.findOneBy({ guildId }),
    memoryConfigRepo.findOneBy({ guildId }),
    xpConfigRepo.findOneBy({ guildId }),
    baitConfigRepo.findOneBy({ guildId }),
  ]);

  const enabled = new Set<GatedModule>();
  if (ticketCfg) enabled.add('tickets');
  if (appCfg) enabled.add('applications');
  if (annCfg) enabled.add('announcements');
  if (memCfg) enabled.add('memory');
  if (xpCfg?.enabled) enabled.add('xp');
  if (baitCfg?.enabled) enabled.add('baitchannel');
  return enabled;
}

function signatureOf(enabled: Set<GatedModule>): string {
  return [...enabled].sort().join(',');
}

/**
 * Pure gating decision: should a command with this name be visible given the
 * set of enabled modules? Commands not mapped to a gated module are always
 * visible. Exported for unit testing.
 */
export function isCommandVisible(commandName: string, enabled: Set<GatedModule>): boolean {
  const mod = COMMAND_MODULE[commandName];
  return !mod || enabled.has(mod);
}

// commandList — and the entire slash-command builder graph it imports — is
// loaded LAZILY. Modules that wire the refresh trigger (api handlers, the
// command dispatcher, channelDelete, bot-setup flows) import this file at
// module load; pulling the builder graph in with them perturbed Bun's
// process-shared mock.module state in tests. The heavy load now happens only
// when commands are actually (re)registered — i.e. at startup or on a real
// toggle — never just from importing the refresh helpers.
async function filterCommandsByEnabled(enabled: Set<GatedModule>) {
  const { commands } = await import('../../commands/commandList');
  return commands.filter(cmd => {
    const name = commandName(cmd);
    return name ? isCommandVisible(name, enabled) : true;
  });
}

async function putGuildCommands(guildId: string, enabled: Set<GatedModule>): Promise<void> {
  const body = await filterCommandsByEnabled(enabled);
  await getRest().put(Routes.applicationGuildCommands(getClientId(), guildId), { body });
  lastRegisteredSignature.set(guildId, signatureOf(enabled));
}

/**
 * Register a guild's filtered command set and record its module signature.
 * Used at startup and on guildCreate. Throws on REST failure (callers handle).
 */
export async function registerGuildCommands(guildId: string): Promise<void> {
  await putGuildCommands(guildId, await getEnabledGatedModules(guildId));
}

async function refreshGuildCommandsNow(guildId: string): Promise<void> {
  const enabled = await getEnabledGatedModules(guildId);
  // Skip the PUT entirely when the visible-module set is unchanged — this is
  // what makes requestGuildCommandRefresh safe to call liberally.
  if (lastRegisteredSignature.get(guildId) === signatureOf(enabled)) return;
  await putGuildCommands(guildId, enabled);
  enhancedLogger.info(`Refreshed guild commands (enabled: ${signatureOf(enabled) || 'none'})`, LogCategory.SYSTEM, {
    guildId,
  });
}

/**
 * Request a (debounced) re-registration of a guild's slash commands after a
 * module is enabled/disabled. Safe to call from any toggle site: rapid changes
 * are coalesced and a Discord PUT is issued only when the enabled-module set
 * actually changed since the last registration.
 */
export function requestGuildCommandRefresh(guildId: string): void {
  const existing = pendingRefreshTimers.get(guildId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingRefreshTimers.delete(guildId);
    refreshGuildCommandsNow(guildId).catch(error => {
      enhancedLogger.error(`Failed to refresh commands for guild ${guildId}`, error as Error, LogCategory.SYSTEM);
    });
  }, REFRESH_DEBOUNCE_MS);
  // Don't keep the process alive solely for a pending refresh.
  if (typeof timer.unref === 'function') timer.unref();

  pendingRefreshTimers.set(guildId, timer);
}

/**
 * Forget a guild's cached registration signature. Call after the guild's
 * commands are unregistered externally (e.g. /bot-reset) so the next setup
 * re-registers correctly.
 */
export function clearGuildCommandSignature(guildId: string): void {
  lastRegisteredSignature.delete(guildId);
  const pending = pendingRefreshTimers.get(guildId);
  if (pending) {
    clearTimeout(pending);
    pendingRefreshTimers.delete(guildId);
  }
}

/**
 * Slash setup commands that can change a guild's enabled-module set. The
 * central command dispatcher calls {@link maybeRefreshCommandsAfterSetup}
 * after any command runs, so the picker updates without each setup handler
 * wiring its own refresh. (Bait/dashboard/webapp/channel-delete toggles do not
 * flow through the slash dispatcher and are wired at their own sites.)
 */
const SETUP_COMMANDS = new Set(['xp-setup', 'ticket-setup', 'application-setup', 'announcement-setup', 'memory-setup']);

/** If `commandName` is a setup command that may change module visibility, request a debounced refresh. */
export function maybeRefreshCommandsAfterSetup(commandName: string, guildId: string): void {
  if (SETUP_COMMANDS.has(commandName)) requestGuildCommandRefresh(guildId);
}

/** Test-only: the static command→module map. */
export const __COMMAND_MODULE = COMMAND_MODULE;
