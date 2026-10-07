/**
 * `/bot-health`: checks this server's saved Cogworks settings against Discord
 * and repairs what it can. Never module-gated and allowed without a BotConfig,
 * so it also works on a half-set-up server. Subcommands: `check` and `repair`,
 * with the same options.
 */
import { PermissionFlagsBits, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../lang';
import { HEALTH_SYSTEM_CHOICES } from '../../utils/health/systems';

const tl = lang.health.command;

export { HEALTH_SYSTEM_CHOICES };

const systemLabels = tl.systems as Record<string, string>;

/** `system`, `deep` and the owner-only `guild-id`, described by `strings`. */
function subcommand(name: string, strings: typeof tl.builder.check): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName(name)
    .setDescription(strings.descrp)
    .addStringOption(option =>
      option
        .setName('system')
        .setDescription(strings.system)
        .setRequired(false)
        .addChoices(...['all', ...HEALTH_SYSTEM_CHOICES].map(id => ({ name: systemLabels[id] ?? id, value: id }))),
    )
    .addBooleanOption(option => option.setName('deep').setDescription(strings.deep).setRequired(false))
    .addStringOption(option =>
      option.setName('guild-id').setDescription(strings.guildId).setRequired(false).setMinLength(17).setMaxLength(20),
    );
}

export const botHealth = new SlashCommandBuilder()
  .setName('bot-health')
  .setDescription(tl.builder.cmdDescrp)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand(subcommand('check', tl.builder.check))
  .addSubcommand(subcommand('repair', tl.builder.repair))
  .toJSON();
