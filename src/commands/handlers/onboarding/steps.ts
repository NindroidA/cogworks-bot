import { type CacheType, type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import onboardingLang from '../../../lang/onboarding.json';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { enhancedLogger, LANGF } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import type { OnboardingStepDef, OnboardingStepType } from '../../../utils/onboarding/types';

const configRepo = lazyRepo(OnboardingConfig);
const tl = onboardingLang;

/** Max onboarding steps per guild */
const MAX_STEPS = 10;

/**
 * Generate a step ID from the title (lowercase, hyphenated, max 20 chars).
 */
function generateStepId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
}

/**
 * Add a new step to the onboarding flow.
 */
export async function stepAddHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;
  const type = interaction.options.getString('type', true) as OnboardingStepType;
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description', true);
  const required = interaction.options.getBoolean('required', false) ?? true;

  let config = await configRepo.findOneBy({ guildId });
  if (!config) {
    config = configRepo.create({ guildId, steps: [] });
  }

  const steps = config.steps || [];

  if (steps.length >= MAX_STEPS) {
    await interaction.reply({
      content: tl.step.maxReached,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const stepId = generateStepId(title);

  // Check for duplicate ID
  if (steps.some(s => s.id === stepId)) {
    await interaction.reply({
      content: tl.step.duplicateId,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const newStep: OnboardingStepDef = {
    id: stepId,
    type,
    title,
    description,
    required,
  };

  steps.push(newStep);
  config.steps = steps;
  await configRepo.save(config);

  await interaction.reply({
    content: LANGF(tl.step.added, title, steps.length.toString()),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command(`Onboarding step added: ${stepId}`, interaction.user.id, guildId);
}

/**
 * Remove a step from the onboarding flow.
 */
export async function stepRemoveHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;
  const stepId = interaction.options.getString('step', true);

  const config = await configRepo.findOneBy({ guildId });
  if (!config?.steps || config.steps.length === 0) {
    await interaction.reply({
      content: tl.step.notFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const index = config.steps.findIndex(s => s.id === stepId);
  if (index === -1) {
    await interaction.reply({
      content: tl.step.notFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const removedStep = config.steps.splice(index, 1)[0];
  await configRepo.save(config);

  // If no steps left, disable onboarding
  if (config.steps.length === 0 && config.enabled) {
    config.enabled = false;
    await configRepo.save(config);
  }

  await interaction.reply({
    content: LANGF(tl.step.removed, removedStep.title),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command(`Onboarding step removed: ${stepId}`, interaction.user.id, guildId);
}

/**
 * List all onboarding steps.
 */
export async function stepListHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;

  const config = await configRepo.findOneBy({ guildId });
  const steps = config?.steps || [];

  if (steps.length === 0) {
    await interaction.reply({
      content: tl.step.list.empty,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(tl.step.list.title)
    .setFooter({
      text: LANGF(tl.step.list.footer, steps.length.toString()),
    });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const reqLabel = step.required ? tl.step.list.requiredLabel : tl.step.list.optionalLabel;
    embed.addFields({
      name: `${i + 1}. ${step.title}`,
      value: `**Type:** ${step.type} | **${reqLabel}**\n${step.description.slice(0, 200)}${step.description.length > 200 ? '...' : ''}`,
    });
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}
