/**
 * Onboarding Engine
 *
 * Sends the full onboarding flow via DM to a guild member.
 * Each step is a separate DM message with interactive components.
 * Collectors have a 24-hour TTL and use the `onboarding_` custom ID prefix.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type GuildMember,
  type Message,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { OnboardingCompletion } from '../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../typeorm/entities/onboarding/OnboardingConfig';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { OnboardingStepDef } from './types';

/** 24 hours in milliseconds */
const COLLECTOR_TTL = 24 * 60 * 60 * 1000;

/**
 * Sends the full onboarding flow to a member via DM.
 * Returns true if onboarding was initiated, false if DMs are closed or no steps configured.
 */
export async function sendOnboardingFlow(member: GuildMember): Promise<boolean> {
  const guildId = member.guild.id;
  const configRepo = AppDataSource.getRepository(OnboardingConfig);
  const config = await configRepo.findOneBy({ guildId });

  if (!config?.enabled || !config.steps || config.steps.length === 0) {
    return false;
  }

  // Upsert a completion record so we track the start
  const completionRepo = AppDataSource.getRepository(OnboardingCompletion);
  let completion = await completionRepo.findOneBy({
    guildId,
    userId: member.id,
  });
  if (!completion) {
    completion = completionRepo.create({
      guildId,
      userId: member.id,
      completedSteps: [],
    });
    await completionRepo.save(completion);
  }

  // Send welcome message
  const welcomeText = config.welcomeMessage
    .replace(/{server}/g, member.guild.name)
    .replace(/{user}/g, member.displayName);

  let dmChannel: Awaited<ReturnType<GuildMember['createDM']>>;
  try {
    dmChannel = await member.createDM();
  } catch {
    enhancedLogger.debug(`Cannot open DM for onboarding: ${member.user.tag}`, LogCategory.SYSTEM, {
      guildId,
    });
    return false;
  }

  try {
    const welcomeEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`Welcome to ${member.guild.name}!`)
      .setDescription(welcomeText)
      .setThumbnail(member.guild.iconURL() || null)
      .setFooter({ text: `Step 0/${config.steps.length}` });

    await dmChannel.send({ embeds: [welcomeEmbed] });
  } catch {
    enhancedLogger.debug(
      `Failed to send onboarding welcome DM to ${member.user.tag}`,
      LogCategory.SYSTEM,
      { guildId },
    );
    return false;
  }

  // Walk through each step sequentially
  const completedSteps: string[] = [...(completion.completedSteps || [])];

  for (let i = 0; i < config.steps.length; i++) {
    const step = config.steps[i];
    // Skip if already completed (e.g. resend scenario)
    if (completedSteps.includes(step.id)) continue;

    const success = await sendStep(dmChannel, member, step, i, config.steps.length);
    if (success) {
      completedSteps.push(step.id);
      completion.completedSteps = completedSteps;
      completion.lastStepAt = new Date();
      await completionRepo.save(completion);
    } else if (step.required) {
      // Required step was not completed; stop flow
      enhancedLogger.debug(
        `Onboarding stopped at required step "${step.id}" for ${member.user.tag}`,
        LogCategory.SYSTEM,
        { guildId },
      );
      return true; // We did start the flow
    }
  }

  // All steps completed — grant role and mark done
  completion.completedSteps = completedSteps;
  completion.completedAt = new Date();
  await completionRepo.save(completion);

  if (config.completionRoleId) {
    try {
      await member.roles.add(config.completionRoleId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to grant onboarding completion role',
        error as Error,
        LogCategory.SYSTEM,
        { guildId, userId: member.id, roleId: config.completionRoleId },
      );
    }
  }

  // Send completion message
  try {
    const doneEmbed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Onboarding Complete!')
      .setDescription(
        `You've completed the onboarding for **${member.guild.name}**. Enjoy your stay!`,
      );
    await dmChannel.send({ embeds: [doneEmbed] });
  } catch {
    // Best-effort
  }

  enhancedLogger.info(`Onboarding completed for ${member.user.tag}`, LogCategory.SYSTEM, {
    guildId,
  });

  return true;
}

/**
 * Sends a single onboarding step and waits for interaction.
 * Returns true if the step was completed.
 */
async function sendStep(
  dmChannel: Awaited<ReturnType<GuildMember['createDM']>>,
  member: GuildMember,
  step: OnboardingStepDef,
  stepIndex: number,
  totalSteps: number,
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
        // Informational only — just a continue button
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboarding_continue_${step.id}`)
            .setLabel('Continue')
            .setStyle(ButtonStyle.Primary),
        );
        if (!step.required) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`onboarding_skip_${step.id}`)
              .setLabel('Skip')
              .setStyle(ButtonStyle.Secondary),
          );
        }
        message = await dmChannel.send({ embeds: [embed], components: [row] });
        break;
      }

      case 'role-select': {
        if (!step.options || step.options.length === 0) {
          // No options — treat as message
          message = await dmChannel.send({ embeds: [embed] });
          return true;
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`onboarding_roleselect_${step.id}`)
          .setPlaceholder('Select your roles...')
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
            .setLabel('Confirm Selection')
            .setStyle(ButtonStyle.Primary),
        );
        if (!step.required) {
          buttonRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`onboarding_skip_${step.id}`)
              .setLabel('Skip')
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
        // Show channel suggestions and a continue button
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`onboarding_continue_${step.id}`)
            .setLabel('Got it!')
            .setStyle(ButtonStyle.Primary),
        );
        if (!step.required) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`onboarding_skip_${step.id}`)
              .setLabel('Skip')
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
            .setEmoji('\u2705'),
        );
        message = await dmChannel.send({ embeds: [embed], components: [row] });
        break;
      }

      case 'custom-question': {
        // Custom question with a continue/acknowledge button
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
              .setLabel('Skip')
              .setStyle(ButtonStyle.Secondary),
          );
        }
        message = await dmChannel.send({ embeds: [embed], components: [row] });
        break;
      }

      default: {
        // Unknown step type — skip
        return !step.required;
      }
    }
  } catch {
    // Cannot send DM
    return false;
  }

  // Wait for interaction
  return await waitForStepInteraction(message, member, step);
}

/**
 * Waits for the user to interact with a step message.
 * Handles role assignment for role-select steps.
 */
async function waitForStepInteraction(
  message: Message,
  member: GuildMember,
  step: OnboardingStepDef,
): Promise<boolean> {
  let selectedRoles: string[] = [];

  try {
    // Create a collector for ALL component interactions on this message
    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === member.id,
      time: COLLECTOR_TTL,
    });

    return await new Promise<boolean>(resolve => {
      collector.on('collect', async interaction => {
        try {
          const customId = interaction.customId;

          // Handle select menu interactions (role-select)
          if (interaction.isStringSelectMenu() && customId.startsWith('onboarding_roleselect_')) {
            selectedRoles = interaction.values;
            await interaction.reply({
              content: `Selected ${selectedRoles.length} role(s). Click **Confirm Selection** to continue.`,
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }

          // Handle button interactions
          if (interaction.isButton()) {
            if (customId.startsWith('onboarding_skip_')) {
              await interaction.update({ components: [] });
              collector.stop('skipped');
              resolve(true);
              return;
            }

            if (customId.startsWith('onboarding_confirmrole_')) {
              // Assign selected roles
              if (selectedRoles.length > 0) {
                for (const roleId of selectedRoles) {
                  try {
                    await member.roles.add(roleId);
                  } catch (error) {
                    enhancedLogger.debug(
                      `Failed to add role ${roleId} during onboarding`,
                      LogCategory.SYSTEM,
                      { error: (error as Error).message },
                    );
                  }
                }
              }
              await interaction.update({ components: [] });
              collector.stop('completed');
              resolve(true);
              return;
            }

            if (
              customId.startsWith('onboarding_continue_') ||
              customId.startsWith('onboarding_accept_')
            ) {
              await interaction.update({ components: [] });
              collector.stop('completed');
              resolve(true);
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
          // Timed out
          resolve(false);
        }
      });
    });
  } catch {
    return false;
  }
}
