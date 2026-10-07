/**
 * `/bot-health repair`: runs the health check, previews what the repair
 * planner would fix, and applies the fixes the admin picks.
 *
 * Access is the same as `/bot-health check`: server admins, plus the bot owner
 * anywhere (`guild-id`). A run takes one of the server's 5 repair slots an
 * hour, and a deep one also the deep check's slot; the owner bypasses both,
 * and a run whose check fails gives them back. Applying re-plans the picked
 * fixes from the rows the preview was built from, so the applier's guards
 * catch whatever changed since. The check after it takes no slot.
 */
import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
  MessageFlags,
} from 'discord.js';
import { lang } from '../../../lang';
import { TIMEOUTS } from '../../../utils/constants';
import type { CheckContext } from '../../../utils/health/context';
import { applyRepairPlan, type RepairActor, type RepairResult } from '../../../utils/health/repair/applier';
import { RepairBusyError } from '../../../utils/health/repair/lock';
import { planRepairs } from '../../../utils/health/repair/planner';
import type { RepairFix, RepairPlan } from '../../../utils/health/repair/types';
import { runHealthCheckWithContext } from '../../../utils/health/runner';
import type { HealthReport } from '../../../utils/health/types';
import { guardAdmin } from '../../../utils/interactions/guardHelper';
import { replyEphemeralError } from '../../../utils/interactions/replyHelper';
import { enhancedLogger, LogCategory, logHandlerError } from '../../../utils/monitoring/enhancedLogger';
import { RateLimits } from '../../../utils/security/rateLimiter';
import { requireBotOwner } from '../../../utils/validation/permissionValidator';
import {
  autoKeys,
  CONFIRM_PER_PAGE,
  confirmFixes,
  type PreviewState,
  parsePage,
  REPAIR_CID,
  type RepairRenderOptions,
  renderPreview,
  renderResults,
} from './repairRender';
import {
  type GuildLimit,
  refundSlots,
  removeComponents,
  resolveTargetGuild,
  systemOption,
  takeGuildSlots,
} from './target';

const tl = lang.health.command;
const tr = tl.repair;

/** Test seams. */
export interface RepairDeps {
  runHealthCheckWithContext: typeof runHealthCheckWithContext;
  applyRepairPlan(guild: Guild, plan: RepairPlan, actor: RepairActor): Promise<RepairResult>;
}

/** A button or menu click on the preview. */
type Click = Interaction & MessageComponentInteraction;

/** A preview plus the rows its plan came from, which applying re-plans on. */
interface Session extends PreviewState {
  ctx: CheckContext;
}

/** A fresh preview of a check run: its full plan, the first page, nothing picked. */
function startSession({ report, ctx }: { report: HealthReport; ctx: CheckContext }): Session {
  return { report, ctx, plan: planRepairs(report, ctx), page: 0, selected: new Set() };
}

export async function botHealthRepairHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  deps: RepairDeps = { runHealthCheckWithContext, applyRepairPlan },
): Promise<void> {
  const isOwner = requireBotOwner(interaction.user.id).allowed;
  if (!isOwner && !(await guardAdmin(interaction)).allowed) return;
  const guild = await resolveTargetGuild(client, interaction, isOwner);
  if (!guild) return;

  const deep = interaction.options.getBoolean('deep') ?? false;
  const limits: GuildLimit[] = [{ action: 'bot-health-repair', limit: RateLimits.BOT_HEALTH_REPAIR }];
  if (deep) limits.push({ action: 'bot-health-deep', limit: RateLimits.BOT_HEALTH_DEEP });
  const slots = isOwner ? [] : await takeGuildSlots(interaction, guild.id, limits);
  if (!slots) return;

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  const runOptions = { system: systemOption(interaction), deep };
  const opts: RepairRenderOptions = guild.id === interaction.guildId ? {} : { guildName: guild.name };
  let state: Session;
  try {
    state = startSession(await deps.runHealthCheckWithContext(guild, runOptions));
  } catch (error) {
    // Nothing was previewed, so the run doesn't count against the server's limits.
    refundSlots(slots);
    logHandlerError('bot-health repair', error, { guildId: guild.id });
    await replyEphemeralError(interaction, tr.errors.failed, { bugReport: true });
    return;
  }
  const message = await interaction.editReply(renderPreview(state, opts));
  if (state.plan.fixes.length === 0) return;

  /** Set while a repair runs, so a second click can't start another. */
  let applying = false;
  const collector = message.createMessageComponentCollector({
    time: TIMEOUTS.DASHBOARD,
    filter: i => i.user.id === interaction.user.id,
  });

  /** Re-plans `keys` on the preview's rows, applies them, checks again, and shows the results. */
  const apply = async (i: Click, keys: string[], classes: RepairFix['repair'][]) => {
    // Nothing picked: no repair, no audit row.
    if (keys.length === 0) {
      await i.deferUpdate();
      return;
    }
    // Administrator may have been taken away since the command ran.
    if (!isOwner && !(await guardAdmin(i)).allowed) {
      collector.stop();
      return;
    }
    applying = true;
    try {
      await i.update(renderPreview(state, { ...opts, disabled: true }));
      const plan = planRepairs(state.report, state.ctx, { keys, classes });
      const actor: RepairActor = { userId: interaction.user.id, source: 'command', checkedAt: state.report.checkedAt };
      let result: RepairResult;
      try {
        result = await deps.applyRepairPlan(guild, plan, actor);
      } catch (error) {
        if (!(error instanceof RepairBusyError)) throw error;
        await replyEphemeralError(i, tr.errors.busy);
        await interaction.editReply(renderPreview(state, opts));
        return;
      }
      if (guild.id !== interaction.guildId) {
        enhancedLogger.info('bot-health: owner repaired another server', LogCategory.SECURITY, {
          guildId: guild.id,
          fromGuildId: interaction.guildId,
          counts: result.counts,
        });
      }
      let next: Session | null = null;
      try {
        next = startSession(await deps.runHealthCheckWithContext(guild, runOptions));
        state = next;
      } catch (error) {
        logHandlerError('bot-health repair re-check', error, { guildId: guild.id });
      }
      await interaction.editReply(renderResults(result, next, opts));
    } finally {
      applying = false;
    }
  };

  collector.on('collect', async i => {
    const isApply = i.customId === REPAIR_CID.auto || i.customId === REPAIR_CID.apply;
    try {
      if (applying) {
        await i.deferUpdate();
        return;
      }
      const page = parsePage(i.customId);
      if (i.customId === REPAIR_CID.cancel) {
        await i.update({ content: tr.preview.cancelled, embeds: [], components: [] });
        collector.stop();
      } else if (i.customId === REPAIR_CID.auto) {
        await apply(i, autoKeys(state.plan), ['auto']);
      } else if (i.customId === REPAIR_CID.apply) {
        await apply(i, [...state.selected], ['confirm']);
      } else if (i.customId === REPAIR_CID.select && i.isStringSelectMenu()) {
        // The menu holds one page: its picks replace that page's, and other pages' picks stay.
        const first = state.page * CONFIRM_PER_PAGE;
        const onPage = new Set(
          confirmFixes(state.plan)
            .slice(first, first + CONFIRM_PER_PAGE)
            .map(f => f.key),
        );
        for (const key of onPage) state.selected.delete(key);
        for (const key of i.values) if (onPage.has(key)) state.selected.add(key);
        await i.update(renderPreview(state, opts));
      } else if (page !== null || i.customId === REPAIR_CID.again) {
        state.page = page ?? 0;
        await i.update(renderPreview(state, opts));
      }
    } catch (error) {
      logHandlerError('bot-health repair', error, { guildId: guild.id, customId: i.customId });
      await replyEphemeralError(i, isApply ? tr.errors.applyFailed : tl.errors.viewFailed, { bugReport: true });
      if (isApply) collector.stop();
    }
  });
  collector.on('end', () => removeComponents(interaction));
}
