/**
 * `/bot-health`: checks this server's saved Cogworks settings against Discord.
 * Never module-gated and allowed without a BotConfig, so it also works on a
 * half-set-up server. Subcommands: `check` (a `repair` subcommand comes later).
 */
import { PermissionFlagsBits, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../lang';
import { HEALTH_SYSTEM_CHOICES } from '../../utils/health/systems';

const tl = lang.health.command;

export { HEALTH_SYSTEM_CHOICES };

const systemLabels = tl.systems as Record<string, string>;

const check = new SlashCommandSubcommandBuilder()
  .setName('check')
  .setDescription(tl.builder.check.descrp)
  .addStringOption(option =>
    option
      .setName('system')
      .setDescription(tl.builder.check.system)
      .setRequired(false)
      .addChoices(...['all', ...HEALTH_SYSTEM_CHOICES].map(id => ({ name: systemLabels[id] ?? id, value: id }))),
  )
  .addBooleanOption(option => option.setName('deep').setDescription(tl.builder.check.deep).setRequired(false))
  .addStringOption(option =>
    option
      .setName('guild-id')
      .setDescription(tl.builder.check.guildId)
      .setRequired(false)
      .setMinLength(17)
      .setMaxLength(20),
  );

export const botHealth = new SlashCommandBuilder()
  .setName('bot-health')
  .setDescription(tl.builder.cmdDescrp)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand(check)
  .toJSON();
