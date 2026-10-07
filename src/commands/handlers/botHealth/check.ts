/**
 * `/bot-health check`: runs the read-only health check on this server (or, for
 * the bot owner, another server by ID) and shows the report ephemerally.
 *
 * Access: server admins, plus the bot owner anywhere. Rate limits are per
 * server (1/min, deep 1/10 min); the owner bypasses them, and a run the engine
 * fails is given back so the admin can retry at once. Findings
 * `/bot-health repair` can fix are marked, from a dry-run plan of the rows the
 * check read.
 */
import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { lang } from '../../../lang';
import { TIMEOUTS } from '../../../utils/constants';
import type { CheckContext } from '../../../utils/health/context';
import { planRepairs } from '../../../utils/health/repair/planner';
import type { RepairFix } from '../../../utils/health/repair/types';
import { runHealthCheckWithContext } from '../../../utils/health/runner';
import { HEALTH_SYSTEMS_NOT_CHECKED } from '../../../utils/health/systems';
import type { HealthReport } from '../../../utils/health/types';
import { guardAdmin } from '../../../utils/interactions/guardHelper';
import { replyEphemeralError } from '../../../utils/interactions/replyHelper';
import { enhancedLogger, LogCategory, logHandlerError } from '../../../utils/monitoring/enhancedLogger';
import { RateLimits } from '../../../utils/security/rateLimiter';
import { requireBotOwner } from '../../../utils/validation/permissionValidator';
import { buildExportAttachment, HEALTH_CID, parseViewRequest, type RenderOptions, renderView } from './render';
import { refundSlots, removeComponents, resolveTargetGuild, systemOption, takeGuildSlots } from './target';

const tl = lang.health.command;

/**
 * Which findings `/bot-health repair` would fix, by finding key, from the same
 * rows the check read. Planning only reads; if it throws, the report just
 * shows no fix marks.
 */
export function fixableKeys(report: HealthReport, ctx: CheckContext): Map<string, RepairFix['repair']> {
  try {
    return new Map(planRepairs(report, ctx).fixes.map(fix => [fix.key, fix.repair]));
  } catch (error) {
    enhancedLogger.warn('bot-health: repair planning failed', LogCategory.SYSTEM, {
      guildId: report.guildId,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

export async function botHealthCheckHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  deps = { runHealthCheckWithContext }, // test seam
): Promise<void> {
  const isOwner = requireBotOwner(interaction.user.id).allowed;
  if (!isOwner && !(await guardAdmin(interaction)).allowed) return;

  const guild = await resolveTargetGuild(client, interaction, isOwner);
  if (!guild) return;

  const deep = interaction.options.getBoolean('deep') ?? false;
  const limit = deep
    ? { action: 'bot-health-deep', limit: RateLimits.BOT_HEALTH_DEEP }
    : { action: 'bot-health-check', limit: RateLimits.BOT_HEALTH_CHECK };
  /** The rate-limit slot this run took (none for the owner); given back if the engine fails. */
  const slots = isOwner ? [] : await takeGuildSlots(interaction, guild.id, [limit]);
  if (!slots) return;

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const system = systemOption(interaction);

  let report: HealthReport;
  let ctx: CheckContext;
  try {
    ({ report, ctx } = await deps.runHealthCheckWithContext(guild, { system, deep }));
  } catch (error) {
    // No report came back, so the run doesn't count against the server's limit.
    refundSlots(slots);
    logHandlerError('bot-health check', error, { guildId: guild.id });
    await replyEphemeralError(interaction, tl.errors.failed, { bugReport: true });
    return;
  }

  const opts: RenderOptions = {
    fixable: fixableKeys(report, ctx),
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
  collector.on('end', () => removeComponents(interaction));
}
