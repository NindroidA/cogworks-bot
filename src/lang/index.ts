/**
 * Centralized language/translation system for the Cogworks Bot
 *
 * This module provides type-safe access to all translation strings across the bot.
 * Strings are organized by feature/module for better maintainability.
 *
 * @example
 * ```typescript
 * import { lang } from './lang';
 *
 * // Type-safe access with autocomplete
 * console.log(lang.general.cmdGuildNotFound);
 * console.log(lang.ticket.created);
 * console.log(lang.application.position.notAvailable);
 * ```
 */

// Import all language modules
import announcement from './announcement.json';
import application from './application.json';
import baitChannel from './baitChannel.json';
import botConfig from './botConfig.json';
import botSetup from './botSetup.json';
import console from './console.json';
import dataExport from './dataExport.json';
import dev from './dev.json';
import errors from './errors.json';
import general from './general.json';
import main from './main.json';
import memory from './memory.json';
import reactionRole from './reactionRole.json';
import roles from './roles.json';
import rules from './rules.json';
import status from './status.json';
import ticket from './ticket.json';
import type { Language } from './types';

/**
 * Complete language object with type safety
 * Access translation strings via: lang.<module>.<key>
 */
export const lang: Language = {
  general,
  main,
  console,
  botConfig,
  botSetup,
  ticket,
  ticketSetup: ticket.setup,
  application,
  addRole: roles.addRole,
  removeRole: roles.removeRole,
  getRoles: roles.getRoles,
  cogdeck: {
    cmdDescrp: 'Base command for the Cogworks Card Game',
  },
  announcement,
  baitChannel,
  dataExport,
  errors,
  dev,
  memory,
  rules,
  reactionRole,
  status,
};

// Export type definitions for external use
export type {
  LangApplication,
  LangConsole,
  LangGeneral,
  LangMain,
  LangTicket,
  Language,
} from './types';

// Default export for convenience
export default lang;
