import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import onboardingLang from '../../../lang/en/onboarding.json';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { createToggleHandler, enhancedLogger, formatLang } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const configRepo = lazyRepo(OnboardingConfig);
const tl = onboardingLang;

const onboardingToggle = createToggleHandler({
  repo: configRepo,
  field: 'enabled',
  messages: {
    alreadyEnabled: tl.setup.alreadyEnabled,
    alreadyDisabled: tl.setup.alreadyDisabled,
    enabled: tl.setup.enabled,
    disabled: tl.setup.disabled,
  },
  // Cannot enable onboarding until at least one step is configured.
  canEnable: config => (!config.steps || config.steps.length === 0 ? tl.setup.noSteps : null),
  onToggled: (interaction, guildId, enabled) =>
    enhancedLogger.command(`Onboarding ${enabled ? 'enabled' : 'disabled'}`, interaction.user.id, guildId),
});

/**
 * Enable the onboarding flow.
 */
export async function enableHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  await onboardingToggle.enable(interaction, interaction.guildId!);
}

/**
 * Disable the onboarding flow.
 */
export async function disableHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  await onboardingToggle.disable(interaction, interaction.guildId!);
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
      content: formatLang(tl.config.completionRole.success, role.toString()),
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
