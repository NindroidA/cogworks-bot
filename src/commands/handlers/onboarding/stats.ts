import { type CacheType, type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { MoreThan } from 'typeorm';
import onboardingLang from '../../../lang/onboarding.json';
import { OnboardingCompletion } from '../../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { LANGF } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const completionRepo = lazyRepo(OnboardingCompletion);
const configRepo = lazyRepo(OnboardingConfig);
const tl = onboardingLang;

/**
 * View onboarding completion statistics.
 */
export async function onboardingStatsHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;
  const days = 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const config = await configRepo.findOneBy({ guildId });
  if (!config) {
    await interaction.reply({
      content: tl.errors.notConfigured,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const allCompletions = await completionRepo.find({
    where: {
      guildId,
      startedAt: MoreThan(cutoff),
    },
  });

  if (allCompletions.length === 0) {
    await interaction.reply({
      content: tl.stats.noData,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const totalStarted = allCompletions.length;
  const completed = allCompletions.filter(c => c.completedAt !== null);
  const totalCompleted = completed.length;
  const completionRate = totalStarted > 0 ? ((totalCompleted / totalStarted) * 100).toFixed(1) : '0.0';

  // Average completion time (for those who completed)
  let avgTime = 'N/A';
  if (completed.length > 0) {
    const totalMs = completed.reduce((sum, c) => {
      const start = c.startedAt.getTime();
      const end = c.completedAt!.getTime();
      return sum + (end - start);
    }, 0);
    const avgMs = totalMs / completed.length;
    const avgMinutes = Math.round(avgMs / 60000);
    if (avgMinutes < 60) {
      avgTime = `${avgMinutes} minute(s)`;
    } else {
      const hours = Math.floor(avgMinutes / 60);
      const mins = avgMinutes % 60;
      avgTime = `${hours}h ${mins}m`;
    }
  }

  // Drop-off analysis: count how many stopped at each step
  const steps = config.steps || [];
  let dropOffText = '';
  if (steps.length > 0) {
    const incomplete = allCompletions.filter(c => c.completedAt === null);
    const dropOff: Record<string, number> = {};
    for (const entry of incomplete) {
      const completedSteps = entry.completedSteps || [];
      const stoppedAtIndex = completedSteps.length;
      const stoppedAtStep = steps[stoppedAtIndex];
      if (stoppedAtStep) {
        dropOff[stoppedAtStep.title] = (dropOff[stoppedAtStep.title] || 0) + 1;
      }
    }

    dropOffText = Object.entries(dropOff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([step, count]) => `\`${step}\`: ${count} dropped`)
      .join('\n');
  }

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(tl.stats.title)
    .setDescription(LANGF(tl.stats.description, days.toString()))
    .addFields(
      { name: tl.stats.totalStarted, value: `${totalStarted}`, inline: true },
      { name: tl.stats.totalCompleted, value: `${totalCompleted}`, inline: true },
      { name: tl.stats.completionRate, value: `${completionRate}%`, inline: true },
      { name: tl.stats.avgCompletionTime, value: avgTime, inline: true },
    );

  if (dropOffText) {
    embed.addFields({
      name: tl.stats.dropOffSteps,
      value: dropOffText,
      inline: false,
    });
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}
