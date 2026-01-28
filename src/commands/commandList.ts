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
import { baitChannelCommand } from './builders/baitChannel';
import { botSetup } from './builders/botSetup';
import { coffee } from './builders/coffee';
import { dataExport } from './builders/dataExport';
import { dev } from './builders/dev';
import { memory } from './builders/memory';
import { memorySetup } from './builders/memorySetup';
import { migrate } from './builders/migrate';
import { ping } from './builders/ping';
import { role } from './builders/role';
import { ticket } from './builders/ticket';
import { ticketSetup } from './builders/ticketSetup';

// Base commands available in all environments
const baseCommands = [
	botSetup,            // bot setup
	role,                // role management (add, remove, list)
	ticketSetup,         // ticket setup
	ticket,              // ticket management (custom types & email import)
	applicationSetup,    // application setup
	application,         // application management (position)
	announcementSetup,   // announcement setup
	announcement,        // announcement module
	baitChannelCommand,  // bait channel system
	dataExport,          // data export
	dev,                 // development/maintenance commands (admin-only)
	migrate,             // migration commands (admin-only)
	ping,                // ping/status command
	coffee,              // support/donation command
	memorySetup,         // memory system setup
	memory               // memory/todo tracking system
];

// All commands available in both dev and production
export const commands = baseCommands;
