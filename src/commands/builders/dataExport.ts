/**
 * Data Export Command Builder
 *
 * GDPR Compliance: Allows guild administrators to export all their server's data
 * Rate Limited: 1 export per 24 hours per guild
 */

import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

export const dataExport = new SlashCommandBuilder()
  .setName('data-export')
  .setDescription(lang.dataExport.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .toJSON();
