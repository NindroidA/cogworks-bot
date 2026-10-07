/**
 * English, the reference locale: one module per JSON file in this folder.
 * `Language` (`../types.ts`) is derived from this object, so a new key needs
 * only its JSON edit; a new file also needs one import and one entry here.
 *
 * Every file is imported statically so `tsc` copies it into `dist/`
 * (production runs from `dist` alone, so no fs or glob loading).
 */

import analyticsEn from './analytics.json';
import announcementEn from './announcement.json';
import applicationEn from './application.json';
import automodEn from './automod.json';
import baitChannelEn from './baitChannel.json';
import botConfigEn from './botConfig.json';
import botSetupEn from './botSetup.json';
import consoleEn from './console.json';
import dataExportEn from './dataExport.json';
import devEn from './dev.json';
import errorsEn from './errors.json';
import eventEn from './event.json';
import generalEn from './general.json';
import healthEn from './health.json';
import importEn from './import.json';
import mainEn from './main.json';
import memoryEn from './memory.json';
import onboardingEn from './onboarding.json';
import reactionRoleEn from './reactionRole.json';
import rolesEn from './roles.json';
import rulesEn from './rules.json';
import starboardEn from './starboard.json';
import statusEn from './status.json';
import ticketEn from './ticket.json';
import xpEn from './xp.json';

export const englishModules = {
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
  health: healthEn,
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
