/**
 * Data Export Command Builder
 * 
 * GDPR Compliance: Allows guild administrators to export all their server's data
 * Rate Limited: 1 export per 24 hours per guild
 */

import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';

export const dataExport = new SlashCommandBuilder()
	.setName('data-export')
	.setDescription('Export all server data (GDPR compliance) - Admin only, rate limited to once per 24 hours')
	.setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
	.toJSON();
