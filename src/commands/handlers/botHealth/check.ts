/**
 * `/bot-health check`: runs the read-only health check on this server (or, for
 * the bot owner, another server by ID) and shows the report ephemerally.
 *
 * Access: server admins, plus the bot owner anywhere. Rate limits are per
 * server (1/min, deep 1/10 min); the owner bypasses them, and a run the engine
 * fails is given back so the admin can retry at once.
 */
import { type CacheType, type ChatInputCommandInteraction, type Client, type Guild, MessageFlags } from 'discord.js';
import { lang } from '../../../lang';
import { isValidSnowflake } from '../../../utils/api/helpers';
import { TIMEOUTS } from '../../../utils/constants';
import { runHealthCheck } from '../../../utils/health/runner';
import { HEALTH_SYSTEMS_NOT_CHECKED } from '../../../utils/health/systems';
import type { HealthReport, HealthSystem } from '../../../utils/health/types';
import { guardAdmin, guardAdminRateLimit } from '../../../utils/interactions/guardHelper';
import { replyEphemeralError } from '../../../utils/interactions/replyHelper';
import { enhancedLogger, LogCategory, logHandlerError } from '../../../utils/monitoring/enhancedLogger';
import { createRateLimitKey, RateLimits, rateLimiter } from '../../../utils/security/rateLimiter';
import { requireBotOwner } from '../../../utils/validation/permissionValidator';
import {
  buildExportAttachment,
  fillTemplate,
  HEALTH_CID,
  parseViewRequest,
  type RenderOptions,
  renderView,
} from './render';

const tl = lang.health.command;

/** The server to check: the current one, or for the bot owner the `guild-id` option. Replies and returns null on error. */
async function resolveTargetGuild(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  isOwner: boolean,
): Promise<Guild | null> {
  const requested = interaction.options.getString('guild-id')?.trim();
  if (!requested) {
    if (!interaction.guild) await replyEphemeralError(interaction, lang.general.cmdGuildNotFound);
    return interaction.guild;
  }
  const valid = isValidSnowflake(requested);
  const guild = isOwner && valid ? client.guilds.cache.get(requested) : undefined;
  if (guild) {
    if (guild.id !== interaction.guildId) {
      enhancedLogger.info('bot-health: owner checked another server', LogCategory.SECURITY, {
        guildId: guild.id,
        fromGuildId: interaction.guildId,
      });
    }
    return guild;
  }
  let error = fillTemplate(tl.errors.guildNotFound, { guildId: requested });
  if (!isOwner) error = tl.errors.notOwner;
  else if (!valid) error = fillTemplate(tl.errors.invalidGuildId, { guildId: requested });
  await replyEphemeralError(interaction, error);
  return null;
}

export async function botHealthCheckHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  deps = { runHealthCheck }, // test seam
): Promise<void> {
  const isOwner = requireBotOwner(interaction.user.id).allowed;
  if (!isOwner && !(await guardAdmin(interaction)).allowed) return;

  const guild = await resolveTargetGuild(client, interaction, isOwner);
  if (!guild) return;

  const deep = interaction.options.getBoolean('deep') ?? false;
  /** The rate-limit slot this run took; given back if the engine fails. */
  let rateKey: string | undefined;
  if (!isOwner) {
    // Non-owners only ever check their own server, so the interaction's guild is the key.
    const limit = deep
      ? { action: 'bot-health-deep', limit: RateLimits.BOT_HEALTH_DEEP }
      : { action: 'bot-health-check', limit: RateLimits.BOT_HEALTH_CHECK };
    const rate = await guardAdminRateLimit(interaction, { ...limit, scope: 'guild', skipPermissionCheck: true });
    if (!rate.allowed) return;
    rateKey = createRateLimitKey.guild(guild.id, limit.action);
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const choice = interaction.options.getString('system');
  const system = choice && choice !== 'all' ? (choice as HealthSystem) : undefined;

  let report: HealthReport;
  try {
    report = await deps.runHealthCheck(guild, { system, deep });
  } catch (error) {
    // No report came back, so the run doesn't count against the server's limit.
    if (rateKey) rateLimiter.reset(rateKey);
    logHandlerError('bot-health check', error, { guildId: guild.id });
    await replyEphemeralError(interaction, tl.errors.failed, { bugReport: true });
    return;
  }

  const opts: RenderOptions = {
    ...(guild.id === interaction.guildId ? {} : { guildName: guild.name }),
    // A check of everything also names the systems that have no checks yet, so none is silently left out.
    ...(system ? {} : { notCheckedYet: HEALTH_SYSTEMS_NOT_CHECKED }),
  };
  const message = await interaction.editReply(renderView(report, { kind: 'summary' }, opts));

  const collector = message.createMessageComponentCollector({
    time: TIMEOUTS.DASHBOARD,
    filter: i => i.user.id === interaction.user.id,
  });
  collector.on('collect', async i => {
    try {
      if (i.customId === HEALTH_CID.export) {
        await i.reply({
          content: tl.export.content,
          files: [buildExportAttachment(report)],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      const view = parseViewRequest(i.customId, i.isStringSelectMenu() ? i.values : []);
      if (view) await i.update(renderView(report, view, opts));
    } catch (error) {
      logHandlerError('bot-health view', error, { guildId: guild.id, customId: i.customId });
      await replyEphemeralError(i, tl.errors.viewFailed, { bugReport: true });
    }
  });
  collector.on('end', async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch (error) {
      // The reply was dismissed or the token expired; nothing left to tidy.
      enhancedLogger.debug('bot-health: could not remove components', LogCategory.COMMAND_EXECUTION, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
