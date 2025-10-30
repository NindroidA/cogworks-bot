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
import { getRoles } from './builders/getRoles';
import { removeRole } from './builders/removeRole';
import { ticketReply } from './builders/ticketReply';
import { ticketSetup } from './builders/ticketSetup';

export const commands = [
	botSetup,            // bot setup
	addRole,             // add a role
	removeRole,          // remove a role
	getRoles,            // get roles
	ticketSetup,         // ticket setup
	ticketReply,         // ticket reply
	applicationSetup,    // application setup
	applicationPosition, // application position
	announcementSetup,   // announcement setup
	announcement,        // announcement module
	baitChannelCommand,  // bait channel system
	dataExport           // data export
];
