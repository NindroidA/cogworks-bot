/**
 * Context Menu Command Builders
 *
 * Discord now supports up to 15 context menu commands (increased from 5).
 * These provide right-click actions on messages and users.
 *
 * All four are visible to everyone (null default permission): each handler
 * runs a feature guard, so dashboard role grants decide who can use them and
 * guilds with no grants stay admin-only.
 */

import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';

// --- Message Context Menu Commands ---

export const captureToMemory = new ContextMenuCommandBuilder()
  .setName('Capture to Memory')
  .setType(ApplicationCommandType.Message)
  .setDefaultMemberPermissions(null);

// --- User Context Menu Commands ---

export const openTicketForUser = new ContextMenuCommandBuilder()
  .setName('Open Ticket For User')
  .setType(ApplicationCommandType.User)
  .setDefaultMemberPermissions(null);

export const viewBaitScore = new ContextMenuCommandBuilder()
  .setName('View Bait Score')
  .setType(ApplicationCommandType.User)
  .setDefaultMemberPermissions(null);

export const manageRestrictions = new ContextMenuCommandBuilder()
  .setName('Manage Restrictions')
  .setType(ApplicationCommandType.User)
  .setDefaultMemberPermissions(null);

// --- All context menu commands for registration ---

export const contextMenuCommands = [captureToMemory, openTicketForUser, viewBaitScore, manageRestrictions];
