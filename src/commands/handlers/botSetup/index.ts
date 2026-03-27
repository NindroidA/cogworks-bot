/**
 * Bot Setup Handler — Unified Dashboard
 *
 * Single entry point for all setup scenarios (first-time, partial, reconfigure).
 * Shows a persistent dashboard embed with system statuses and a select menu
 * to configure individual systems. Supports partial saves and resume-later.
 */

import type { CacheType, ChatInputCommandInteraction, Client, MessageComponentInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags } from 'discord.js';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { SetupState, type SystemStates } from '../../../typeorm/entities/SetupState';
import {
  createButtonCollector,
  createErrorEmbed,
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  lang,
  notifyModalTimeout,
  RateLimits,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { checkboxGroup, labelWrap, rawModal } from '../../../utils/modalComponents';
import { buildDashboardEmbed, buildSystemSelector, detectSystemStates, mergeStates, SYSTEMS } from './setupDashboard';
import { runSystemFlow } from './systemFlows';

const setupStateRepo = lazyRepo(SetupState);
const botConfigRepo = lazyRepo(BotConfig);

export async function botSetupHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [createErrorEmbed(lang.botSetup.errors.serverOnly)],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guard = await guardAdminRateLimit(interaction, {
    action: 'bot-setup',
    limit: RateLimits.BOT_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guild.id;

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

  await interaction.showModal(modal as any);

  const submit = await interaction.awaitModalSubmit({ time: 300_000 }).catch(async () => {
    await notifyModalTimeout(interaction);
    return null;
  });
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

  buttonCollector.on('collect', async (btnInteraction: any) => {
    if (btnInteraction.customId === 'setup_finish_later') {
      explicitlyClosed = true;
      await btnInteraction.update({
        content: 'Setup progress saved. Run `/bot-setup` anytime to continue.',
        embeds: [],
        components: [],
      });
      selectCollector.stop();
      buttonCollector.stop();
    } else if (btnInteraction.customId === 'setup_manage_systems') {
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

      await btnInteraction.showModal(modal as any);

      const modalSubmit = await btnInteraction.awaitModalSubmit({ time: 300_000 }).catch(async () => {
        await notifyModalTimeout(btnInteraction);
        return null;
      });
      if (!modalSubmit) return;

      const enabledValues: string[] = (modalSubmit.fields as any).getField('setup_enabled_systems')?.values ?? [];
      setupState.selectedSystems = enabledValues.length > 0 ? enabledValues : null;
      await setupStateRepo.save(setupState);

      // Refresh dashboard
      const dbStates = await detectSystemStates(guildId);
      const freshStates = mergeStates(dbStates, setupState);
      setupState.systemStates = freshStates;
      await setupStateRepo.save(setupState);

      await modalSubmit.deferUpdate();

      try {
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
    } else if (btnInteraction.customId === 'setup_reset') {
      // Confirmation prompt before resetting
      await btnInteraction.update({
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
    } else if (btnInteraction.customId === 'setup_reset_confirm') {
      explicitlyClosed = true;
      await setupStateRepo.delete({ guildId });
      await btnInteraction.update({
        content: 'Setup state reset. Run `/bot-setup` to start fresh.',
        embeds: [],
        components: [],
      });
      selectCollector.stop();
      buttonCollector.stop();
    } else if (btnInteraction.customId === 'setup_reset_cancel') {
      // Restore the dashboard
      const dbStates = await detectSystemStates(guildId);
      const freshStates = mergeStates(dbStates, setupState);
      const embed = buildDashboardEmbed(freshStates, setupState.selectedSystems);
      const selector = buildSystemSelector(freshStates, setupState.selectedSystems);
      const buttons = buildDashboardButtons(freshStates, setupState.selectedSystems);
      await btnInteraction.update({
        embeds: [embed],
        components: [selector, buttons],
      });
    }
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
    new ButtonBuilder().setCustomId('setup_reset').setLabel('Reset Setup').setStyle(ButtonStyle.Danger).setEmoji('🔄'),
  );
}
