/**
 * Onboarding Handler Router
 * Routes to the appropriate handler based on subcommand.
 */

import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import onboardingLang from '../../../lang/onboarding.json';
import { AppDataSource } from '../../../typeorm';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { enhancedLogger, guardAdminRateLimit, handleInteractionError, LANGF, lang, RateLimits } from '../../../utils';
import { sendOnboardingFlow } from '../../../utils/onboarding/onboardingEngine';
import { completionRoleHandler, disableHandler, enableHandler, welcomeMessageHandler } from './setup';
import { onboardingStatsHandler } from './stats';
import { stepAddHandler, stepListHandler, stepRemoveHandler } from './steps';

const tl = onboardingLang;

export async function onboardingHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  try {
    const guard = await guardAdminRateLimit(interaction, {
      action: 'onboarding',
      limit: RateLimits.ANNOUNCEMENT_SETUP,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    if (!interaction.guildId) return;
    const _guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'enable':
        await enableHandler(client, interaction);
        break;

      case 'disable':
        await disableHandler(client, interaction);
        break;

      case 'welcome-message':
        await welcomeMessageHandler(client, interaction);
        break;

      case 'completion-role':
        await completionRoleHandler(client, interaction);
        break;

      case 'step-add':
        await stepAddHandler(client, interaction);
        break;

      case 'step-remove':
        await stepRemoveHandler(client, interaction);
        break;

      case 'step-list':
        await stepListHandler(client, interaction);
        break;

      case 'stats':
        await onboardingStatsHandler(client, interaction);
        break;

      case 'preview':
        await previewHandler(client, interaction);
        break;

      case 'resend':
        await resendHandler(client, interaction);
        break;

      default:
        await interaction.reply({
          content: lang.errors.unknownSubcommand,
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, tl.errors.general);
  }
}

/**
 * Preview the onboarding flow by DM'ing the invoking admin.
 */
const previewHandler = async (_client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
  const guildId = interaction.guildId!;

  const configRepo = AppDataSource.getRepository(OnboardingConfig);
  const config = await configRepo.findOneBy({ guildId });

  if (!config?.steps || config.steps.length === 0) {
    await interaction.reply({
      content: tl.preview.noSteps,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.reply({
    content: tl.preview.sending,
    flags: [MessageFlags.Ephemeral],
  });

  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (!member) return;

  const sent = await sendOnboardingFlow(member);
  if (sent) {
    await interaction.editReply({ content: tl.preview.sent });
  } else {
    await interaction.editReply({ content: tl.preview.failed });
  }
};

/**
 * Resend the onboarding flow to a specific user.
 */
const resendHandler = async (_client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
  const guildId = interaction.guildId!;
  const targetUser = interaction.options.getUser('user', true);

  const configRepo = AppDataSource.getRepository(OnboardingConfig);
  const config = await configRepo.findOneBy({ guildId });

  if (!config?.steps || config.steps.length === 0) {
    await interaction.reply({
      content: tl.resend.noSteps,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const member = interaction.guild?.members.cache.get(targetUser.id);
  if (!member) {
    await interaction.reply({
      content: LANGF(tl.resend.failed, targetUser.toString()),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const sent = await sendOnboardingFlow(member);
  if (sent) {
    await interaction.editReply({
      content: LANGF(tl.resend.success, targetUser.toString()),
    });
  } else {
    await interaction.editReply({
      content: LANGF(tl.resend.failed, targetUser.toString()),
    });
  }

  enhancedLogger.command(`Onboarding resent to ${targetUser.tag}`, interaction.user.id, guildId);
};
