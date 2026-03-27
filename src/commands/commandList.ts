/**
 * Command List
 *
 * Centralized list of all slash commands to be registered.
 * Used by both main bot initialization and guildCreate event.
 */

import { announcement } from './builders/announcement';
import { announcementSetup } from './builders/announcementSetup';
import { application } from './builders/application';
import { applicationSetup } from './builders/applicationSetup';
import { archive } from './builders/archive';
import { automodCommand } from './builders/automod';
import { baitChannelCommand } from './builders/baitChannel';
import { botReset } from './builders/botReset';
import { botSetup } from './builders/botSetup';
import { coffee } from './builders/coffee';
import { contextMenuCommands } from './builders/contextMenus';
import { dashboard } from './builders/dashboard';
import { dataExport } from './builders/dataExport';
import { dev } from './builders/dev';
import { devSuite } from './builders/devSuite';
import { devTest } from './builders/devTest';
import { event } from './builders/event';
import { importCommand } from './builders/import';
import { insights } from './builders/insights';
import { memory } from './builders/memory';
import { memorySetup } from './builders/memorySetup';
import { migrate } from './builders/migrate';
import { onboarding } from './builders/onboarding';
import { ping } from './builders/ping';
import { reactionRole } from './builders/reactionRole';
import { role } from './builders/role';
import { rulesSetup } from './builders/rulesSetup';
import { server } from './builders/server';
import { starboard } from './builders/starboard';
import { status } from './builders/status';
import { ticket } from './builders/ticket';
import { ticketSetup } from './builders/ticketSetup';
import { leaderboard, rank, xpAdmin } from './builders/xp';
import { xpSetup } from './builders/xpSetup';

// Base commands available in all environments
const baseCommands = [
  botSetup, // bot setup
  role, // role management (add, remove, list)
  ticketSetup, // ticket setup
  ticket, // ticket management (custom types & email import)
  applicationSetup, // application setup
  application, // application management (position)
  announcementSetup, // announcement setup
  announcement, // announcement module
  baitChannelCommand, // bait channel system
  dataExport, // data export
  dev, // development/maintenance commands (admin-only)
  migrate, // migration commands (admin-only)
  ping, // ping/status command
  coffee, // support/donation command
  memorySetup, // memory system setup
  memory, // memory/todo tracking system
  rulesSetup, // rules acknowledgment system
  reactionRole, // reaction role menu system
  server, // development server invite link
  dashboard, // web dashboard link
  starboard, // starboard system
  status, // outage status system (owner-only)
  importCommand, // bot data import system (MEE6, CSV)
  rank, // XP rank card
  leaderboard, // XP leaderboard
  xpSetup, // XP system configuration
  xpAdmin, // XP admin commands (set, reset)
  onboarding, // interactive onboarding flow
  automodCommand, // AutoMod integration
  event, // scheduled events manager
  insights, // server analytics & insights
  botReset, // factory reset / offboarding
  archive, // archive cleanup and export
];

const IS_DEV = (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';

// Dev-only commands (only registered when running the dev bot)
const slashCommands = IS_DEV ? [...baseCommands, devTest, devSuite] : baseCommands;

// All commands: slash + context menu
export const commands = [...slashCommands, ...contextMenuCommands];
