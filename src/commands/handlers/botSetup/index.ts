/**
 * Bot Setup Handler — Unified Dashboard
 *
 * Single entry point for all setup scenarios (first-time, partial, reconfigure).
 * Shows a persistent dashboard embed with system statuses and a select menu
 * to configure individual systems. Supports partial saves and resume-later.
 */

import type { CacheType, ChatInputCommandInteraction, Client, MessageComponentInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags } from 'discord.js';
import { DEFAULT_LOCALE, invalidateGuildLocaleCache, isSupportedLocale, SUPPORTED_LOCALES } from '../../../lang';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { SetupState, type SystemStates } from '../../../typeorm/entities/SetupState';
import {
  createButtonCollector,
  createErrorEmbed,
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  RateLimits,
  showAndAwaitModal,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { checkboxGroup, labelWrap, radioGroup, rawModal } from '../../../utils/modalComponents';
import { buildDashboardEmbed, buildSystemSelector, detectSystemStates, mergeStates, SYSTEMS } from './setupDashboard';
import { runSystemFlow } from './systemFlows';

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  de: 'Deutsch',
};

const setupStateRepo = lazyRepo(SetupState);
const botConfigRepo = lazyRepo(BotConfig);

export async function botSetupHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'bot-setup',
    limit: RateLimits.BOT_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;

  try {
    // Ensure BotConfig exists (required for the bot to function)
    let botConfig = await botConfigRepo.findOneBy({ guildId });
    if (!botConfig) {
      botConfig = botConfigRepo.create({
        guildId,
        enableGlobalStaffRole: false,
      });
      await botConfigRepo.save(botConfig);
    }

    // Load or create SetupState
    let setupState = await setupStateRepo.findOneBy({ guildId });

    if (!setupState) {
      // Check if guild already has configured systems (backwards compat for existing servers)
      const dbStates = await detectSystemStates(guildId);
      const hasExistingConfig = Object.values(dbStates).some(s => s !== 'not_started');

      if (hasExistingConfig) {
        // Existing server — create SetupState from detected configs and show dashboard
        setupState = setupStateRepo.create({
          guildId,
          selectedSystems: null, // null = all systems shown
          systemStates: dbStates,
          partialData: null,
        });
        await setupStateRepo.save(setupState);
        await showDashboard(interaction, client, guildId, setupState);
        return;
      }

      // Truly first-time setup — show system selection modal
      await showSystemSelection(interaction, client, guildId);
      return;
    }

    // Returning user — show dashboard with current states
    await showDashboard(interaction, client, guildId, setupState);
  } catch (error) {
    enhancedLogger.error('Bot setup handler failed', error as Error, LogCategory.COMMAND_EXECUTION, { guildId });
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [createErrorEmbed('Setup failed. Please try again.')],
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
}

/**
 * First-time setup: show checkbox group to select systems, then create SetupState and show dashboard.
 */
async function showSystemSelection(
  interaction: ChatInputCommandInteraction<CacheType>,
  client: Client,
  guildId: string,
): Promise<void> {
  const modal = rawModal(`setup_select_${Date.now()}`, 'Bot Setup — Select Systems', [
    labelWrap(
      'Systems to Configure',
      checkboxGroup(
        'setup_systems',
        SYSTEMS.filter(s => s.id !== 'reactionRole').map(s => ({
          label: s.label,
          value: s.id,
          description: s.description,
        })),
        0,
      ),
      'Select which systems you want to set up (you can add more later)',
    ),
  ]);

  const submit = await showAndAwaitModal(interaction, modal);
  if (!submit) return;

  const selectedSystems: string[] = (submit.fields as any).getField('setup_systems')?.values ?? [];

  // Create SetupState
  const setupState = setupStateRepo.create({
    guildId,
    selectedSystems: selectedSystems.length > 0 ? selectedSystems : null,
    systemStates: {
      staffRole: 'not_started',
      ticket: 'not_started',
      application: 'not_started',
      announcement: 'not_started',
      baitchannel: 'not_started',
      memory: 'not_started',
      rules: 'not_started',
      reactionRole: 'not_started',
    },
    partialData: null,
  });
  await setupStateRepo.save(setupState);

  // Detect any already-configured systems
  const dbStates = await detectSystemStates(guildId);
  const states = mergeStates(dbStates, setupState);
  setupState.systemStates = states;
  await setupStateRepo.save(setupState);

  // Show dashboard
  await showDashboardFromSubmit(submit, client, guildId, setupState);
}

/**
 * Show the setup dashboard with system statuses and selector.
 */
async function showDashboard(
  interaction: ChatInputCommandInteraction<CacheType> | MessageComponentInteraction,
  client: Client,
  guildId: string,
  setupState: SetupState,
): Promise<void> {
  // Re-detect states from DB to stay current
  const dbStates = await detectSystemStates(guildId);
  const states = mergeStates(dbStates, setupState);
  setupState.systemStates = states;
  await setupStateRepo.save(setupState);

  const embed = buildDashboardEmbed(states, setupState.selectedSystems);
  const selector = buildSystemSelector(states, setupState.selectedSystems);
  const buttons = buildDashboardButtons(states, setupState.selectedSystems);

  const response = await interaction.reply({
    embeds: [embed],
    components: [selector, buttons],
    flags: [MessageFlags.Ephemeral],
    withResponse: true,
  });
  const reply = response.resource?.message;
  if (!reply) return;

  await collectDashboardInteractions(reply, interaction, client, guildId, setupState);
}

/**
 * Show dashboard from a modal submit interaction (different reply method).
 */
async function showDashboardFromSubmit(
  interaction: any,
  client: Client,
  guildId: string,
  setupState: SetupState,
): Promise<void> {
  const states = setupState.systemStates;
  const embed = buildDashboardEmbed(states, setupState.selectedSystems);
  const selector = buildSystemSelector(states, setupState.selectedSystems);
  const buttons = buildDashboardButtons(states, setupState.selectedSystems);

  const response = await interaction.reply({
    embeds: [embed],
    components: [selector, buttons],
    flags: [MessageFlags.Ephemeral],
    withResponse: true,
  });
  const reply = response.resource?.message;
  if (!reply) return;

  await collectDashboardInteractions(reply, interaction, client, guildId, setupState);
}

/**
 * Set up collectors for the dashboard's select menu and buttons.
 */
async function collectDashboardInteractions(
  reply: any,
  interaction: any,
  client: Client,
  guildId: string,
  setupState: SetupState,
): Promise<void> {
  // Collect select menu interactions
  const selectCollector = reply.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: (i: any) => i.user.id === interaction.user.id && i.customId === 'setup_system_select',
    time: 300_000,
  });

  const buttonCollector = createButtonCollector(reply, 300_000);

  selectCollector.on('collect', async (selectInteraction: any) => {
    const systemId = selectInteraction.values[0];
    const result = await runSystemFlow(systemId, selectInteraction, client, guildId, setupState);

    // Always refresh the dashboard (restores it from any intermediate state)
    setupState.systemStates = result.states;
    try {
      const dbStates = await detectSystemStates(guildId);
      const freshStates = mergeStates(dbStates, setupState);
      setupState.systemStates = freshStates;
      if (result.updated) await setupStateRepo.save(setupState);

      const embed = buildDashboardEmbed(freshStates, setupState.selectedSystems);
      const selector = buildSystemSelector(freshStates, setupState.selectedSystems);
      const buttons = buildDashboardButtons(freshStates, setupState.selectedSystems);

      await interaction.editReply({
        content: '',
        embeds: [embed],
        components: [selector, buttons],
      });
    } catch (err) {
      enhancedLogger.warn('Dashboard refresh failed after system flow', LogCategory.COMMAND_EXECUTION, {
        guildId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  let explicitlyClosed = false;

  // Re-detect states from DB and replace the dashboard message with a fresh embed.
  // Used by the manage-systems, language, and reset-cancel handlers.
  const refreshDashboard = async (): Promise<void> => {
    try {
      const dbStates = await detectSystemStates(guildId);
      const freshStates = mergeStates(dbStates, setupState);
      setupState.systemStates = freshStates;
      const embed = buildDashboardEmbed(freshStates, setupState.selectedSystems);
      const selector = buildSystemSelector(freshStates, setupState.selectedSystems);
      const buttons = buildDashboardButtons(freshStates, setupState.selectedSystems);
      await interaction.editReply({
        content: '',
        embeds: [embed],
        components: [selector, buttons],
      });
    } catch {
      /* interaction may have expired */
    }
  };

  const closeDashboard = (): void => {
    explicitlyClosed = true;
    selectCollector.stop();
    buttonCollector.stop();
  };

  type DashboardHandler = (btn: any) => Promise<void>;

  const DASHBOARD_ROUTES: Record<string, DashboardHandler> = {
    setup_finish_later: async btn => {
      await btn.update({
        content: 'Setup progress saved. Run `/bot-setup` anytime to continue.',
        embeds: [],
        components: [],
      });
      closeDashboard();
    },

    setup_manage_systems: async btn => {
      const currentEnabled = setupState.selectedSystems;
      const modal = rawModal(`setup_manage_${Date.now()}`, 'Manage Systems', [
        labelWrap(
          'Enabled Systems',
          checkboxGroup(
            'setup_enabled_systems',
            SYSTEMS.map(s => ({
              label: s.label,
              value: s.id,
              description: s.description,
              default: !currentEnabled || currentEnabled.includes(s.id),
            })),
            0,
          ),
          'Uncheck systems you want to disable',
        ),
      ]);

      const modalSubmit = await showAndAwaitModal(btn, modal);
      if (!modalSubmit) return;

      const enabledValues: string[] = (modalSubmit.fields as any).getField('setup_enabled_systems')?.values ?? [];
      setupState.selectedSystems = enabledValues.length > 0 ? enabledValues : null;
      await setupStateRepo.save(setupState);
      await modalSubmit.deferUpdate();
      await refreshDashboard();
      await setupStateRepo.save(setupState);
    },

    setup_language: async btn => {
      // Load the guild's current locale so the radio group reflects it.
      let currentLocale: string = DEFAULT_LOCALE;
      try {
        const config = await botConfigRepo.findOneBy({ guildId });
        if (config?.locale && isSupportedLocale(config.locale)) {
          currentLocale = config.locale;
        }
      } catch {
        /* fall back to DEFAULT_LOCALE */
      }

      const modal = rawModal(`setup_language_${Date.now()}`, 'Bot Language', [
        labelWrap(
          'Language',
          radioGroup(
            'setup_locale',
            SUPPORTED_LOCALES.map(code => ({
              label: LOCALE_LABELS[code] ?? code,
              value: code,
              default: code === currentLocale,
            })),
          ),
          'Bot language for this server. Untranslated strings fall back to English.',
        ),
      ]);

      const modalSubmit = await showAndAwaitModal(btn, modal);
      if (!modalSubmit) return;

      const chosen: string | undefined = (modalSubmit.fields as any).getField('setup_locale')?.values?.[0];
      const nextLocale = isSupportedLocale(chosen) ? chosen : DEFAULT_LOCALE;

      try {
        let config = await botConfigRepo.findOneBy({ guildId });
        if (!config) {
          config = botConfigRepo.create({
            guildId,
            enableGlobalStaffRole: false,
            locale: nextLocale,
          });
        } else {
          config.locale = nextLocale;
        }
        await botConfigRepo.save(config);
        invalidateGuildLocaleCache(guildId);
      } catch (err) {
        enhancedLogger.warn('Failed to persist guild locale', LogCategory.COMMAND_EXECUTION, {
          guildId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await modalSubmit.deferUpdate();
      await refreshDashboard();
    },

    setup_reset: async btn => {
      await btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('Reset Setup?')
            .setDescription(
              'This will clear the setup wizard state. Your existing system configurations (tickets, applications, etc.) will remain in the database but will need to be reconfigured.\n\nAre you sure?',
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('setup_reset_confirm').setLabel('Yes, Reset').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('setup_reset_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
    },

    setup_reset_confirm: async btn => {
      await setupStateRepo.delete({ guildId });
      await btn.update({
        content: 'Setup state reset. Run `/bot-setup` to start fresh.',
        embeds: [],
        components: [],
      });
      closeDashboard();
    },

    setup_reset_cancel: async () => {
      await refreshDashboard();
    },
  };

  buttonCollector.on('collect', async (btnInteraction: any) => {
    const handler = DASHBOARD_ROUTES[btnInteraction.customId];
    if (handler) await handler(btnInteraction);
  });

  selectCollector.on('end', async () => {
    if (explicitlyClosed) return;
    // Silently remove components on timeout — no "timed out" message
    try {
      await interaction.editReply({ components: [] });
    } catch {
      /* expired */
    }
  });
}

function buildDashboardButtons(
  states: SystemStates,
  selectedSystems: string[] | null,
): ActionRowBuilder<ButtonBuilder> {
  // Check if all enabled systems are complete
  const enabledSystems = selectedSystems ? SYSTEMS.filter(s => selectedSystems.includes(s.id)) : SYSTEMS;
  const allComplete = enabledSystems.length > 0 && enabledSystems.every(s => states[s.id] === 'complete');

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('setup_finish_later')
      .setLabel(allComplete ? 'Close' : 'Finish Later')
      .setStyle(allComplete ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji(allComplete ? '✅' : '💾'),
    new ButtonBuilder()
      .setCustomId('setup_manage_systems')
      .setLabel('Manage Systems')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⚙️'),
    new ButtonBuilder()
      .setCustomId('setup_language')
      .setLabel('Language')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🌐'),
    new ButtonBuilder().setCustomId('setup_reset').setLabel('Reset Setup').setStyle(ButtonStyle.Danger).setEmoji('🔄'),
  );
}
