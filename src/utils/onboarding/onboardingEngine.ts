/**
 * Onboarding Engine
 *
 * Sends the full onboarding flow via DM to a guild member.
 * Each step is a separate DM message with interactive components.
 * Collectors have a 24-hour TTL and use the `onboarding_` custom ID prefix.
 *
 * The public `sendOnboardingFlow` is a 4-phase orchestration:
 *   1. `loadOnboardingState` — config + completion record + DM channel
 *   2. `sendWelcomeMessage` — opening embed (the call resolves here)
 *   3. `runOnboardingSteps` — sequential per-step send + wait + persist (background)
 *   4. `finalizeOnboarding` — completion role + closing embed (background)
 *
 * Each phase is independently testable; the orchestration just chains them.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type DMChannel,
  EmbedBuilder,
  type GuildMember,
  type Message,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { lang } from '../../lang';
import { AppDataSource } from '../../typeorm';
import { OnboardingCompletion } from '../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../typeorm/entities/onboarding/OnboardingConfig';
import { fmt } from '../../utils';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { OnboardingStepDef } from './types';

const tlEngine = lang.onboarding.engine;

/** 24 hours in milliseconds */
const COLLECTOR_TTL = 24 * 60 * 60 * 1000;

export interface OnboardingFlowOptions {
  /** Admin preview: works while disabled, shows every step, saves nothing and grants no roles. */
  preview?: boolean;
  /** Start again from the first step when the member already finished (resend). */
  restart?: boolean;
}

interface OnboardingState {
  config: OnboardingConfig;
  completion: OnboardingCompletion;
  dmChannel: DMChannel;
  preview: boolean;
}

/**
 * Phase 1: load the guild's onboarding config, ensure a completion record
 * exists for this member, and open a DM channel. Returns null if onboarding
 * is disabled (unless previewing), has no steps, or the user has DMs closed.
 */
async function loadOnboardingState(
  member: GuildMember,
  options: OnboardingFlowOptions,
): Promise<OnboardingState | null> {
  const guildId = member.guild.id;
  const preview = options.preview === true;
  const configRepo = AppDataSource.getRepository(OnboardingConfig);
  const config = await configRepo.findOneBy({ guildId });

  if ((!config?.enabled && !preview) || !config?.steps || config.steps.length === 0) {
    return null;
  }

  // Upsert completion record so we track the start regardless of where the
  // flow stops (DM closed, required step skipped, etc). A preview uses an
  // unsaved record, so the admin's stats and progress stay untouched.
  const completionRepo = AppDataSource.getRepository(OnboardingCompletion);
  let completion = preview ? null : await completionRepo.findOneBy({ guildId, userId: member.id });
  if (!completion) {
    completion = completionRepo.create({
      guildId,
      userId: member.id,
      completedSteps: [],
    });
    if (!preview) await completionRepo.save(completion);
  } else if (options.restart && completion.completedAt) {
    completion.completedSteps = [];
    completion.completedAt = null;
  }

  let dmChannel: DMChannel;
  try {
    dmChannel = await member.createDM();
  } catch {
    enhancedLogger.debug(`Cannot open DM for onboarding: ${member.user.tag}`, LogCategory.SYSTEM, { guildId });
    return null;
  }

  return { config, completion, dmChannel, preview };
}

/** Phase 2: send the welcome embed. Returns true if delivered. */
async function sendWelcomeMessage(member: GuildMember, state: OnboardingState): Promise<boolean> {
  const welcomeText = state.config.welcomeMessage
    .replace(/{server}/g, member.guild.name)
    .replace(/{user}/g, member.displayName);

  const welcomeEmbed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(`Welcome to ${member.guild.name}!`)
    .setDescription(welcomeText)
    .setThumbnail(member.guild.iconURL() || null)
    .setFooter({ text: `Step 0/${state.config.steps!.length}` });

  try {
    await state.dmChannel.send({ embeds: [welcomeEmbed] });
    return true;
  } catch {
    enhancedLogger.debug(`Failed to send onboarding welcome DM to ${member.user.tag}`, LogCategory.SYSTEM, {
      guildId: member.guild.id,
    });
    return false;
  }
}

/**
 * Phase 3: walk through each configured step in order. Persists progress
 * after each successful step. Returns true if every required step completed,
 * false if a required step was skipped/timed-out (but always after recording
 * the partial state).
 */
async function runOnboardingSteps(member: GuildMember, state: OnboardingState): Promise<boolean> {
  const { config, completion, dmChannel, preview } = state;
  // `loadOnboardingState` guarantees config.steps is non-null + non-empty;
  // capture it as a local so TS keeps the narrowing through the loop body.
  const steps = config.steps!;
  const completionRepo = AppDataSource.getRepository(OnboardingCompletion);
  const completedSteps: string[] = [...(completion.completedSteps || [])];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (completedSteps.includes(step.id)) continue;

    const success = await sendStep(dmChannel, member, step, i, steps.length, preview);
    if (success) {
      completedSteps.push(step.id);
      completion.completedSteps = completedSteps;
      completion.lastStepAt = new Date();
      if (!preview) await completionRepo.save(completion);
    } else if (step.required) {
      enhancedLogger.debug(
        `Onboarding stopped at required step "${step.id}" for ${member.user.tag}`,
        LogCategory.SYSTEM,
        { guildId: member.guild.id },
      );
      return false;
    }
  }

  completion.completedSteps = completedSteps;
  completion.completedAt = new Date();
  if (!preview) await completionRepo.save(completion);
  return true;
}

/** Phase 4: grant the completion role + send the closing embed. Best-effort. */
async function finalizeOnboarding(member: GuildMember, state: OnboardingState): Promise<void> {
  const guildId = member.guild.id;

  if (state.config.completionRoleId && !state.preview) {
    try {
      await member.roles.add(state.config.completionRoleId);
    } catch (error) {
      enhancedLogger.error('Failed to grant onboarding completion role', error as Error, LogCategory.SYSTEM, {
        guildId,
        userId: member.id,
        roleId: state.config.completionRoleId,
      });
    }
  }

  try {
    const doneEmbed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Onboarding Complete!')
      .setDescription(`You've completed the onboarding for **${member.guild.name}**. Enjoy your stay!`);
    await state.dmChannel.send({ embeds: [doneEmbed] });
  } catch {
    // Best-effort
  }

  enhancedLogger.info(`Onboarding completed for ${member.user.tag}`, LogCategory.SYSTEM, { guildId });
}

/**
 * Sends the onboarding flow to a member via DM. Resolves once the welcome DM
 * is delivered: true if the flow started, false if onboarding is off, has no
 * steps, or DMs are closed. The steps run in the background (each waits up to
 * 24h), so a slash command can reply within its 15-minute token. (`true` does
 * NOT mean every step completed — see the OnboardingCompletion record.)
 */
export async function sendOnboardingFlow(member: GuildMember, options: OnboardingFlowOptions = {}): Promise<boolean> {
  const state = await loadOnboardingState(member, options);
  if (!state) return false;

  const welcomed = await sendWelcomeMessage(member, state);
  if (!welcomed) return false;

  void runOnboardingSteps(member, state)
    .then(allDone => (allDone ? finalizeOnboarding(member, state) : undefined))
    .catch(error =>
      enhancedLogger.error('Onboarding flow failed', error as Error, LogCategory.SYSTEM, {
        guildId: member.guild.id,
        userId: member.id,
      }),
    );
  return true;
}

/**
 * Sends a single onboarding step and waits for interaction.
 * Returns true if the step was completed.
 */
async function sendStep(
  dmChannel: DMChannel,
  member: GuildMember,
  step: OnboardingStepDef,
  stepIndex: number,
  totalSteps: number,
  preview: boolean,
): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(step.title)
    .setDescription(step.description)
    .setFooter({
      text: `Step ${stepIndex + 1}/${totalSteps}${step.required ? ' (required)' : ' (optional)'}`,
    });

  let message: Message;

  try {
    switch (step.type) {
      case 'message': {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboarding_continue_${step.id}`)
            .setLabel(tlEngine.continueL)
            .setStyle(ButtonStyle.Primary),
        );
        if (!step.required) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`onboarding_skip_${step.id}`)
              .setLabel(tlEngine.skipL)
              .setStyle(ButtonStyle.Secondary),
          );
        }
        message = await dmChannel.send({ embeds: [embed], components: [row] });
        break;
      }

      case 'role-select': {
        if (!step.options || step.options.length === 0) {
          message = await dmChannel.send({ embeds: [embed] });
          return true;
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`onboarding_roleselect_${step.id}`)
          .setPlaceholder(tlEngine.rolesPlaceholder)
          .setMinValues(step.required ? 1 : 0)
          .setMaxValues(step.options.length)
          .addOptions(
            step.options.map(opt => ({
              label: opt.label,
              value: opt.roleId,
              emoji: opt.emoji || undefined,
            })),
          );

        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
        const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboarding_confirmrole_${step.id}`)
            .setLabel(tlEngine.confirmSelectionL)
            .setStyle(ButtonStyle.Primary),
        );
        if (!step.required) {
          buttonRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`onboarding_skip_${step.id}`)
              .setLabel(tlEngine.skipL)
              .setStyle(ButtonStyle.Secondary),
          );
        }

        message = await dmChannel.send({
          embeds: [embed],
          components: [selectRow, buttonRow],
        });
        break;
      }

      case 'channel-suggest': {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboarding_continue_${step.id}`)
            .setLabel(tlEngine.gotItL)
            .setStyle(ButtonStyle.Primary),
        );
        if (!step.required) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`onboarding_skip_${step.id}`)
              .setLabel(tlEngine.skipL)
              .setStyle(ButtonStyle.Secondary),
          );
        }
        message = await dmChannel.send({ embeds: [embed], components: [row] });
        break;
      }

      case 'rules-accept': {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboarding_accept_${step.id}`)
            .setLabel('I Accept')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        );
        message = await dmChannel.send({ embeds: [embed], components: [row] });
        break;
      }

      case 'custom-question': {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboarding_continue_${step.id}`)
            .setLabel('Acknowledge')
            .setStyle(ButtonStyle.Primary),
        );
        if (!step.required) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`onboarding_skip_${step.id}`)
              .setLabel(tlEngine.skipL)
              .setStyle(ButtonStyle.Secondary),
          );
        }
        message = await dmChannel.send({ embeds: [embed], components: [row] });
        break;
      }

      default: {
        return !step.required;
      }
    }
  } catch {
    return false;
  }

  return await waitForStepInteraction(message, member, preview);
}

/**
 * Waits for the user to interact with a step message.
 * Handles role assignment for role-select steps (skipped in a preview).
 */
async function waitForStepInteraction(message: Message, member: GuildMember, preview: boolean): Promise<boolean> {
  let selectedRoles: string[] = [];

  try {
    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === member.id,
      time: COLLECTOR_TTL,
    });

    return await new Promise<boolean>(resolve => {
      collector.on('collect', async interaction => {
        try {
          const customId = interaction.customId;

          if (interaction.isStringSelectMenu() && customId.startsWith('onboarding_roleselect_')) {
            selectedRoles = interaction.values;
            await interaction.reply({
              content: fmt(tlEngine.rolesSelectedHint, {
                count: selectedRoles.length,
                button: tlEngine.confirmSelectionL,
              }),
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }

          if (interaction.isButton()) {
            if (customId.startsWith('onboarding_skip_')) {
              await interaction.update({ components: [] });
              collector.stop('skipped');
              void resolve(true);
              return;
            }

            if (customId.startsWith('onboarding_confirmrole_')) {
              if (!preview) {
                for (const roleId of selectedRoles) {
                  try {
                    await member.roles.add(roleId);
                  } catch (error) {
                    enhancedLogger.debug(`Failed to add role ${roleId} during onboarding`, LogCategory.SYSTEM, {
                      error: (error as Error).message,
                    });
                  }
                }
              }
              await interaction.update({ components: [] });
              collector.stop('completed');
              void resolve(true);
              return;
            }

            if (customId.startsWith('onboarding_continue_') || customId.startsWith('onboarding_accept_')) {
              await interaction.update({ components: [] });
              collector.stop('completed');
              void resolve(true);
              return;
            }
          }
        } catch (error) {
          enhancedLogger.debug('Onboarding step interaction error', LogCategory.SYSTEM, {
            error: (error as Error).message,
          });
        }
      });

      collector.on('end', (_collected, reason) => {
        if (reason !== 'completed' && reason !== 'skipped') {
          void resolve(false);
        }
      });
    });
  } catch {
    return false;
  }
}
