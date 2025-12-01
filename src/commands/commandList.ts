/**
 * Command List
 * 
 * Centralized list of all slash commands to be registered.
 * Used by both main bot initialization and guildCreate event.
 */

import { addRole } from './builders/addRole';
import { announcement } from './builders/announcement';
import { announcementSetup } from './builders/announcementSetup';
import { applicationPosition } from './builders/applicationPosition';
import { applicationSetup } from './builders/applicationSetup';
import { baitChannelCommand } from './builders/baitChannel';
import { botSetup } from './builders/botSetup';
import { dataExport } from './builders/dataExport';
import { dev } from './builders/dev';
import { getRoles } from './builders/getRoles';
import { migrate } from './builders/migrate';
import { removeRole } from './builders/removeRole';
import { ticket } from './builders/ticket';
import { ticketReply } from './builders/ticketReply';
import { ticketSetup } from './builders/ticketSetup';

// Base commands available in all environments
const baseCommands = [
	botSetup,            // bot setup
	addRole,             // add a role
	removeRole,          // remove a role
	getRoles,            // get roles
	ticketSetup,         // ticket setup
	ticket,              // ticket management (custom types & email import)
	ticketReply,         // ticket reply
	applicationSetup,    // application setup
	applicationPosition, // application position
	announcementSetup,   // announcement setup
	announcement,        // announcement module
	baitChannelCommand,  // bait channel system
	dataExport,          // data export
	dev,                 // development/maintenance commands (admin-only)
	migrate              // migration commands (admin-only)
];

// All commands available in both dev and production
export const commands = baseCommands;
