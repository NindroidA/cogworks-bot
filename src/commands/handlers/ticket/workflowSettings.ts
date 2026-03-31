/**
 * Ticket Workflow Settings Modal
 *
 * Opens a modal with checkboxes for enabling/disabling workflow and auto-close.
 * Consolidates workflow-enable, workflow-disable, autoclose-enable, autoclose-disable
 * into a single modal interaction.
 */

import { type CacheType, type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import {
  DEFAULT_TICKET_STATUSES,
  enhancedLogger,
  guardAdmin,
  handleInteractionError,
  LogCategory,
  lang,
  showAndAwaitModal,
} from '../../../utils';
import { Colors } from '../../../utils/colors';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { checkbox, labelWrap, rawModal } from '../../../utils/modalComponents';

const ticketConfigRepo = lazyRepo(TicketConfig);

export async function workflowSettingsHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  try {
    const guard = await guardAdmin(interaction);
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const config = await ticketConfigRepo.findOneBy({ guildId });

    if (!config) {
      await interaction.reply({
        content: lang.ticket.ticketConfigNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const modal = rawModal(`ticket_wf_settings_${Date.now()}`, 'Ticket Workflow Settings', [
      labelWrap(
        'Enable Workflow',
        checkbox('wf_enable', config.enableWorkflow),
        'Track ticket statuses, assignments, and history',
      ),
      labelWrap(
        'Enable Auto-Close',
        checkbox('wf_autoclose', config.autoCloseEnabled),
        'Automatically close inactive tickets (requires workflow)',
      ),
    ]);

    const modalSubmit = await showAndAwaitModal(interaction, modal as any);
    if (!modalSubmit) return;

    const enableWorkflow = (modalSubmit.fields as any).getField('wf_enable')?.value as boolean;
    const enableAutoClose = (modalSubmit.fields as any).getField('wf_autoclose')?.value as boolean;

    // Apply workflow changes
    if (enableWorkflow !== undefined) {
      config.enableWorkflow = enableWorkflow;
      if (enableWorkflow && (!config.workflowStatuses || config.workflowStatuses.length === 0)) {
        config.workflowStatuses = [...DEFAULT_TICKET_STATUSES];
      }
    }

    // Auto-close requires workflow
    if (enableAutoClose !== undefined) {
      if (enableAutoClose && !config.enableWorkflow) {
        config.autoCloseEnabled = false;
      } else {
        config.autoCloseEnabled = enableAutoClose;
      }
    }

    await ticketConfigRepo.save(config);

    const embed = new EmbedBuilder()
      .setColor(Colors.status.success)
      .setTitle('Workflow Settings Updated')
      .addFields(
        {
          name: 'Workflow',
          value: config.enableWorkflow ? 'Enabled' : 'Disabled',
          inline: true,
        },
        {
          name: 'Auto-Close',
          value: config.autoCloseEnabled ? `Enabled (${config.autoCloseDays}d)` : 'Disabled',
          inline: true,
        },
      );

    if (enableAutoClose && !config.enableWorkflow) {
      embed.setFooter({
        text: 'Auto-close was disabled because workflow is required.',
      });
    }

    await modalSubmit.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Ticket workflow settings updated via modal', LogCategory.COMMAND_EXECUTION, {
      guildId,
      userId: interaction.user.id,
      enableWorkflow: config.enableWorkflow,
      autoClose: config.autoCloseEnabled,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to update workflow settings');
  }
}
