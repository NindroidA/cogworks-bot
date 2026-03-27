/**
 * Context Menu Command Builders
 *
 * Discord now supports up to 15 context menu commands (increased from 5).
 * These provide right-click actions on messages and users.
 */

import { ApplicationCommandType, ContextMenuCommandBuilder, PermissionFlagsBits } from 'discord.js';

// --- Message Context Menu Commands ---

export const captureToMemory = new ContextMenuCommandBuilder()
  .setName('Capture to Memory')
  .setType(ApplicationCommandType.Message)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const postAsAnnouncement = new ContextMenuCommandBuilder()
  .setName('Post as Announcement')
  .setType(ApplicationCommandType.Message)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const closeApplication = new ContextMenuCommandBuilder()
  .setName('Close Application')
  .setType(ApplicationCommandType.Message)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// --- User Context Menu Commands ---

export const openTicketForUser = new ContextMenuCommandBuilder()
  .setName('Open Ticket For User')
  .setType(ApplicationCommandType.User)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const viewBaitScore = new ContextMenuCommandBuilder()
  .setName('View Bait Score')
  .setType(ApplicationCommandType.User)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const manageRestrictions = new ContextMenuCommandBuilder()
  .setName('Manage Restrictions')
  .setType(ApplicationCommandType.User)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// --- All context menu commands for registration ---

export const contextMenuCommands = [
  captureToMemory,
  postAsAnnouncement,
  closeApplication,
  openTicketForUser,
  viewBaitScore,
  manageRestrictions,
];
