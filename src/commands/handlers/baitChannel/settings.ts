import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { type BaitActionType, BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import {
  enhancedLogger,
  guardAdminRateLimit,
  handleInteractionError,
  LogCategory,
  lang,
  notifyModalTimeout,
  RateLimits,
  safeDbOperation,
} from '../../../utils';
import { Colors } from '../../../utils/colors';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { checkbox, labelWrap, radioGroup, rawModal } from '../../../utils/modalComponents';

const tl = lang.baitChannel;
const configRepo = lazyRepo(BaitChannelConfig);

const VALID_ACTION_TYPES: BaitActionType[] = ['ban', 'kick', 'timeout', 'log-only'];

/**
 * Opens a settings modal with radio groups and checkboxes for bait channel configuration.
 * Pre-populates current values from the database.
 */
export const settingsHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const guildId = interaction.guildId!;
    const guard = await guardAdminRateLimit(interaction, {
      action: 'bait-settings',
      limit: RateLimits.BOT_SETUP,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    const config = await safeDbOperation(() => configRepo.findOneBy({ guildId }), 'Find bait channel config');

    if (!config) {
      await interaction.reply({
        content: tl.setupFirst,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const modal = rawModal(`bait_settings_${Date.now()}`, 'Bait Channel Settings', [
      labelWrap(
        'Action Type',
        radioGroup('bait_action_type', [
          {
            label: 'Ban',
            value: 'ban',
            description: 'Permanently ban the user',
            default: config.actionType === 'ban',
          },
          {
            label: 'Kick',
            value: 'kick',
            description: 'Kick the user from the server',
            default: config.actionType === 'kick',
          },
          {
            label: 'Timeout',
            value: 'timeout',
            description: 'Timeout the user temporarily',
            default: config.actionType === 'timeout',
          },
          {
            label: 'Log Only',
            value: 'log-only',
            description: 'Log the event without action',
            default: config.actionType === 'log-only',
          },
        ]),
        'What happens when a user posts in the bait channel',
      ),
      labelWrap(
        'Test Mode',
        checkbox('bait_test_mode', config.testMode),
        'Log actions without actually banning/kicking',
      ),
      labelWrap(
        'DM Before Action',
        checkbox('bait_dm_before', config.dmBeforeAction),
        'Send a DM to the user before taking action',
      ),
      labelWrap(
        'Extra Message Sweep',
        checkbox('bait_delete_msgs', config.deleteUserMessages),
        'Additional bot-side purge across all channels (ban/kick always delete via Discord)',
      ),
      labelWrap(
        'Escalation Mode',
        checkbox('bait_escalation', config.enableEscalation),
        'Use score-based escalation instead of fixed action',
      ),
    ]);

    await interaction.showModal(modal as any);

    const modalSubmit = await interaction.awaitModalSubmit({ time: 300_000 }).catch(async () => {
      await notifyModalTimeout(interaction);
      return null;
    });
    if (!modalSubmit) return;

    // Extract and validate values
    const rawActionType = (modalSubmit.fields as any).getField('bait_action_type')?.value;
    const testMode = (modalSubmit.fields as any).getField('bait_test_mode')?.value as boolean;
    const dmBefore = (modalSubmit.fields as any).getField('bait_dm_before')?.value as boolean;
    const deleteMsgs = (modalSubmit.fields as any).getField('bait_delete_msgs')?.value as boolean;
    const escalation = (modalSubmit.fields as any).getField('bait_escalation')?.value as boolean;

    // Validate actionType against allowlist (prevents arbitrary string injection)
    if (rawActionType && VALID_ACTION_TYPES.includes(rawActionType as BaitActionType)) {
      config.actionType = rawActionType as BaitActionType;
    }
    if (testMode !== undefined) config.testMode = testMode;
    if (dmBefore !== undefined) config.dmBeforeAction = dmBefore;
    if (deleteMsgs !== undefined) config.deleteUserMessages = deleteMsgs;
    if (escalation !== undefined) config.enableEscalation = escalation;

    await safeDbOperation(() => configRepo.save(config), 'Save bait channel settings');

    // Clear cache
    const { baitChannelManager } = client as ExtendedClient;
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(guildId);
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.status.success)
      .setTitle('Bait Channel Settings Updated')
      .addFields(
        { name: 'Action Type', value: config.actionType, inline: true },
        {
          name: 'Test Mode',
          value: config.testMode ? 'Enabled' : 'Disabled',
          inline: true,
        },
        {
          name: 'DM Before Action',
          value: config.dmBeforeAction ? 'Enabled' : 'Disabled',
          inline: true,
        },
        {
          name: 'Extra Message Sweep',
          value: config.deleteUserMessages ? 'Enabled' : 'Disabled',
          inline: true,
        },
        {
          name: 'Escalation Mode',
          value: config.enableEscalation ? 'Enabled' : 'Disabled',
          inline: true,
        },
      );

    await modalSubmit.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Bait channel settings updated via modal', LogCategory.COMMAND_EXECUTION, {
      guildId,
      userId: interaction.user.id,
      actionType: config.actionType,
      testMode: config.testMode,
      escalation: config.enableEscalation,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to update bait channel settings');
  }
};
