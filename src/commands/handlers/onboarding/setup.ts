import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import onboardingLang from '../../../lang/onboarding.json';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { enhancedLogger, LANGF } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const configRepo = lazyRepo(OnboardingConfig);
const tl = onboardingLang;

/**
 * Enable the onboarding flow.
 */
export async function enableHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;

  let config = await configRepo.findOneBy({ guildId });

  if (!config) {
    config = configRepo.create({ guildId });
  }

  // Cannot enable if no steps are configured
  if (!config.steps || config.steps.length === 0) {
    await interaction.reply({
      content: tl.setup.noSteps,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (config.enabled) {
    await interaction.reply({
      content: tl.setup.alreadyEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.enabled = true;
  await configRepo.save(config);

  await interaction.reply({
    content: tl.setup.enabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command('Onboarding enabled', interaction.user.id, guildId);
}

/**
 * Disable the onboarding flow.
 */
export async function disableHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;

  const config = await configRepo.findOneBy({ guildId });

  if (!config || !config.enabled) {
    await interaction.reply({
      content: tl.setup.alreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.enabled = false;
  await configRepo.save(config);

  await interaction.reply({
    content: tl.setup.disabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command('Onboarding disabled', interaction.user.id, guildId);
}

/**
 * Set the welcome message.
 */
export async function welcomeMessageHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;
  const message = interaction.options.getString('message', true);

  let config = await configRepo.findOneBy({ guildId });
  if (!config) {
    config = configRepo.create({ guildId });
  }

  config.welcomeMessage = message;
  await configRepo.save(config);

  await interaction.reply({
    content: tl.config.welcomeMessage.success,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command('Onboarding welcome message updated', interaction.user.id, guildId);
}

/**
 * Set or clear the completion role.
 */
export async function completionRoleHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;
  const role = interaction.options.getRole('role', false);

  let config = await configRepo.findOneBy({ guildId });
  if (!config) {
    config = configRepo.create({ guildId });
  }

  config.completionRoleId = role?.id || null;
  await configRepo.save(config);

  if (role) {
    await interaction.reply({
      content: LANGF(tl.config.completionRole.success, role.toString()),
      flags: [MessageFlags.Ephemeral],
    });
  } else {
    await interaction.reply({
      content: tl.config.completionRole.cleared,
      flags: [MessageFlags.Ephemeral],
    });
  }

  enhancedLogger.command('Onboarding completion role updated', interaction.user.id, guildId);
}
