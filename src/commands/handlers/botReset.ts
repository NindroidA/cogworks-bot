/**
 * Bot Reset (Offboarding) Handler
 *
 * Factory resets Cogworks for a guild: optionally archives data, cleans up messages, purges DB.
 * Three-stage flow: warning → save data choice → final confirmation, executed sequentially.
 */

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  EmbedBuilder,
  type Message,
  MessageFlags,
  Routes,
} from 'discord.js';
import type { ExtendedClient } from '../../types/ExtendedClient';
import {
  enhancedLogger,
  formatBytes,
  guardAdminRateLimit,
  handleInteractionError,
  LogCategory,
  RateLimits,
} from '../../utils';
import { Colors } from '../../utils/colors';
import { deleteAllGuildData } from '../../utils/database/guildQueries';
import { compileGuildArchive } from '../../utils/offboarding/archiveCompiler';
import { cleanupGuildMessages } from '../../utils/offboarding/messageCleanup';
import { getClientId, getRest } from '../../utils/restClient';
import { clearGuildCommandSignature } from '../../utils/setup/commandGating';

const STAGE_TIMEOUT_MS = 60_000;
const FINAL_STAGE_TIMEOUT_MS = 30_000;
const MAX_DM_SIZE = 8 * 1024 * 1024;

export async function botResetHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  try {
    const guard = await guardAdminRateLimit(interaction, {
      action: 'bot-reset',
      limit: RateLimits.DATA_EXPORT,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // --- Stage 1: Initial warning ---
    const stage1Embed = new EmbedBuilder()
      .setColor(Colors.severity.high)
      .setTitle('Factory Reset Cogworks')
      .setDescription(
        'This will erase **ALL** Cogworks data and messages from this server.\n\n' +
          '**What will be removed:**\n' +
          '- All configurations (tickets, applications, announcements, bait, memory, rules, reaction roles)\n' +
          '- All archived tickets and applications\n' +
          '- All memory items and tags\n' +
          '- All bot-sent messages (buttons, menus, embeds)\n' +
          '- All XP data, event data, analytics data\n' +
          '- All audit logs and bait detection logs\n' +
          '- All slash commands (re-registered on `/bot-setup`)',
      );

    const stage1Buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('reset_continue').setLabel('Continue').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reset_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    const response = await interaction.reply({
      embeds: [stage1Embed],
      components: [stage1Buttons],
      flags: [MessageFlags.Ephemeral],
      withResponse: true,
    });
    const reply = response.resource?.message;
    if (!reply) return;

    const stage1 = await awaitButtonChoice(reply, userId, STAGE_TIMEOUT_MS);
    if (!stage1) return notifyTimedOut(interaction);
    if (stage1.customId === 'reset_cancel') {
      await stage1.update({
        content: 'Reset cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    // --- Stage 2: Save data choice (3-way: yes/no/cancel) ---
    const stage2Embed = new EmbedBuilder()
      .setColor(Colors.status.info)
      .setTitle('Save Your Data?')
      .setDescription(
        'Would you like an archive of your data sent to your DMs before everything is deleted?\n\n' +
          'The archive includes all tickets, applications, memory items, XP data, and configurations in a compressed JSON file.',
      );

    const stage2Buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('reset_save_yes')
        .setLabel('Save Data First')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💾'),
      new ButtonBuilder().setCustomId('reset_save_no').setLabel('No, Delete Everything').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reset_cancel2').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    await stage1.update({ embeds: [stage2Embed], components: [stage2Buttons] });

    const stage2 = await awaitButtonChoice(reply, userId, STAGE_TIMEOUT_MS);
    if (!stage2) return notifyTimedOut(interaction);
    if (stage2.customId === 'reset_cancel2') {
      await stage2.update({
        content: 'Reset cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    const saveData = stage2.customId === 'reset_save_yes';

    // --- Stage 3: Final confirmation ---
    const stage3Embed = new EmbedBuilder()
      .setColor(Colors.severity.critical)
      .setTitle('Are you ABSOLUTELY sure?')
      .setDescription(
        'This action is **PERMANENT** and **CANNOT BE UNDONE**.\n\n' +
          (saveData
            ? 'Your data archive will be sent to your DMs before deletion.\n\n'
            : '**No data will be saved.** Everything will be permanently deleted.\n\n') +
          'The bot will remain in the server — you can re-configure it with `/bot-setup`.',
      );

    const stage3Buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('reset_confirm_final')
        .setLabel('Yes, Reset Everything')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('reset_cancel_final').setLabel('No, Go Back').setStyle(ButtonStyle.Secondary),
    );

    await stage2.update({ embeds: [stage3Embed], components: [stage3Buttons] });

    const stage3 = await awaitButtonChoice(reply, userId, FINAL_STAGE_TIMEOUT_MS);
    if (!stage3) return notifyTimedOut(interaction);
    if (stage3.customId === 'reset_cancel_final') {
      await stage3.update({
        content: 'Reset cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    // --- Execute reset ---
    await stage3.update({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.status.info)
          .setTitle('Resetting...')
          .setDescription(
            saveData
              ? 'Compiling archive and cleaning up. This may take a moment.'
              : 'Cleaning up. This may take a moment.',
          ),
      ],
      components: [],
    });

    await executeReset(client, interaction, guildId, saveData);
  } catch (error) {
    await handleInteractionError(interaction, error, 'Bot reset');
  }
}

/**
 * Await a single button click on the reply message.
 * Returns the button interaction (already in pre-acknowledge state — caller
 * is responsible for calling `.update()` on it) or null on timeout.
 */
function awaitButtonChoice(reply: Message, userId: string, timeout: number): Promise<ButtonInteraction | null> {
  return reply
    .awaitMessageComponent({
      filter: i => i.user.id === userId,
      componentType: ComponentType.Button,
      time: timeout,
    })
    .catch(() => null);
}

async function notifyTimedOut(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    await interaction.editReply({
      content: 'Reset timed out.',
      embeds: [],
      components: [],
    });
  } catch {
    /* expired */
  }
}

/**
 * Execute the actual reset: optional archive DM, message cleanup, cache clear,
 * DB purge, command unregistration, and summary embed.
 */
async function executeReset(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  guildId: string,
  saveData: boolean,
): Promise<void> {
  try {
    let dmSent = false;
    let sizeFormatted = '';

    // 1. Compile and send archive (if user chose to save)
    if (saveData) {
      const archive = await compileGuildArchive(guildId);
      sizeFormatted = formatBytes(archive.stats.compressedSizeBytes);

      if (archive.stats.compressedSizeBytes > MAX_DM_SIZE) {
        enhancedLogger.warn(`Archive too large for DM: ${sizeFormatted}`, LogCategory.COMMAND_EXECUTION, { guildId });
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.severity.high)
              .setTitle('Archive Too Large')
              .setDescription(
                `The archive is ${sizeFormatted} which exceeds Discord's 8 MB DM limit. Use \`/data-export\` to get your data before resetting, then run \`/bot-reset\` again.`,
              ),
          ],
          components: [],
        });
        return;
      }

      try {
        const attachment = new AttachmentBuilder(archive.buffer, {
          name: archive.filename,
        });
        await interaction.user.send({
          content: `**Cogworks Archive** for ${interaction.guild!.name}\n${archive.stats.totalEntries} entries (${sizeFormatted} compressed)\nTickets: ${archive.stats.archivedTickets} | Applications: ${archive.stats.archivedApplications} | Memory: ${archive.stats.memoryItems}`,
          files: [attachment],
        });
        dmSent = true;
      } catch {
        enhancedLogger.warn('Failed to DM archive to admin', LogCategory.COMMAND_EXECUTION, {
          guildId,
          userId: interaction.user.id,
        });
      }

      if (!dmSent) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.severity.medium)
              .setTitle('DM Failed')
              .setDescription('Could not send the archive to your DMs. Check your DM settings. Continuing with reset.'),
          ],
        });
      }
    }

    // 2. Clean up messages
    const cleanup = await cleanupGuildMessages(client, guildId);

    // 3. Clear caches
    try {
      (client as ExtendedClient).baitChannelManager?.clearConfigCache(guildId);
    } catch {
      /* cache clear is best-effort */
    }

    // 4. Purge database
    const purgeResult = await deleteAllGuildData(guildId);

    // 5. Unregister guild commands
    let commandsRemoved = false;
    try {
      await getRest().put(Routes.applicationGuildCommands(getClientId(), guildId), { body: [] });
      commandsRemoved = true;
      // Drop the cached registration signature so a later re-setup re-registers.
      clearGuildCommandSignature(guildId);
    } catch {
      enhancedLogger.warn('Failed to unregister guild commands during reset', LogCategory.COMMAND_EXECUTION, {
        guildId,
      });
    }

    // 6. Show summary
    const summaryFields = [
      {
        name: 'Messages Cleaned',
        value: `${cleanup.deleted} deleted`,
        inline: true,
      },
      {
        name: 'Database',
        value: `${purgeResult.total} records purged from ${purgeResult.tables} tables`,
        inline: true,
      },
      {
        name: 'Commands',
        value: commandsRemoved ? 'Removed' : 'Failed to remove',
        inline: true,
      },
    ];

    if (saveData) {
      summaryFields.unshift({
        name: 'Archive',
        value: dmSent ? `Sent to your DMs (${sizeFormatted})` : 'Failed to DM — check your DM settings',
        inline: true,
      });
    }

    const summaryEmbed = new EmbedBuilder()
      .setColor(Colors.status.success)
      .setTitle('Factory Reset Complete')
      .addFields(summaryFields)
      .setFooter({
        text: 'Run /bot-setup to reconfigure Cogworks for this server.',
      });

    await interaction.editReply({ embeds: [summaryEmbed], components: [] });

    enhancedLogger.info('Guild factory reset completed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      userId: interaction.user.id,
      dataSaved: saveData,
      messagesDeleted: cleanup.deleted,
      recordsPurged: purgeResult.total,
    });
  } catch (error) {
    enhancedLogger.error('Factory reset execution failed', error as Error, LogCategory.COMMAND_EXECUTION, { guildId });
    await interaction.editReply({
      content: 'An error occurred during reset. Some data may have been partially deleted. Contact support if needed.',
      embeds: [],
      components: [],
    });
  }
}
