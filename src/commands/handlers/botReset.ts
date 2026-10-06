/**
 * Bot Reset (Offboarding) Handler
 *
 * Factory resets Cogworks for a guild: optionally archives data, cleans up messages, purges DB.
 * Three-stage flow: warning → save data choice → final confirmation, executed sequentially.
 * If the admin chose to save, nothing is deleted unless the archive reached their DMs.
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
} from 'discord.js';
import {
  createRateLimitKey,
  enhancedLogger,
  formatBytes,
  guardAdmin,
  handleInteractionError,
  LogCategory,
  type RateLimitConfig,
  rateLimiter,
} from '../../utils';
import { writeAuditLog } from '../../utils/api/handlers/auditHelper';
import { TRANSCRIPT_CAPTURE_BUDGET_MS } from '../../utils/archive/transcriptCapture';
import { Colors } from '../../utils/colors';
import { deleteAllGuildData } from '../../utils/database/guildQueries';
import { compileGuildArchive } from '../../utils/offboarding/archiveCompiler';
import { invalidateBaitCaches } from '../../utils/offboarding/guildCaches';
import { MAX_EXPORT_ATTACHMENT_BYTES } from '../../utils/offboarding/guildDataExport';
import { type CleanupOptions, cleanupGuildMessages } from '../../utils/offboarding/messageCleanup';
import { clearGuildCommandSignature, registerGuildCommands } from '../../utils/setup/commandGating';

const STAGE_TIMEOUT_MS = 60_000;
const FINAL_STAGE_TIMEOUT_MS = 30_000;
/** How many failed tables the summary names before "+N more". */
const MAX_FAILED_LISTED = 10;
/** How many kept threads/channels the summary names before "+N more". */
const MAX_KEPT_LISTED = 15;

/** One completed reset per guild per day. Spent at the final confirmation, given back if the reset doesn't finish. */
const BOT_RESET_LIMIT: RateLimitConfig = {
  maxAttempts: 1,
  windowMs: 24 * 60 * 60 * 1000,
  message: '⏱️ `/bot-reset` can only be run once per day. Please try again tomorrow.',
};

/** Injectable seams so tests can drive the reset without Discord or a database. */
export interface BotResetDeps {
  compileGuildArchive: typeof compileGuildArchive;
  cleanupGuildMessages: typeof cleanupGuildMessages;
  deleteAllGuildData: typeof deleteAllGuildData;
  registerGuildCommands: typeof registerGuildCommands;
}

const DEFAULT_DEPS: BotResetDeps = {
  compileGuildArchive,
  cleanupGuildMessages,
  deleteAllGuildData,
  registerGuildCommands,
};

export async function botResetHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  deps: BotResetDeps = DEFAULT_DEPS,
) {
  try {
    const guard = await guardAdmin(interaction);
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const rateLimitKey = createRateLimitKey.guild(guildId, 'bot-reset');

    // Only peek here: Cancel, a timeout or an aborted reset must not use up the day's reset.
    if (rateLimiter.getRemaining(rateLimitKey, BOT_RESET_LIMIT.maxAttempts) === 0) {
      await interaction.reply({ content: BOT_RESET_LIMIT.message, flags: [MessageFlags.Ephemeral] });
      return;
    }

    // --- Stage 1: Initial warning ---
    const stage1Embed = new EmbedBuilder()
      .setColor(Colors.severity.high)
      .setTitle('Factory Reset Cogworks')
      .setDescription(
        'This will erase **ALL** Cogworks data and messages from this server.\n\n' +
          '**What will be removed:**\n' +
          '- All configurations (tickets, applications, announcements, bait, memory, rules, reaction roles)\n' +
          '- All archived tickets and applications, including their transcript threads\n' +
          '- All open ticket and application channels\n' +
          '- All memory items, tags and threads\n' +
          '- All bot-sent messages (buttons, menus, embeds)\n' +
          '- All XP data, event data, analytics data\n' +
          '- All audit logs, bait detection logs and role permission grants\n' +
          '- Module commands (`/bot-setup` and the other setup commands stay available)',
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
          'The archive is a compressed JSON file with every Cogworks record for this server (configurations, tickets, ' +
          'applications, memory items, XP data, logs) plus the text of every transcript, memory thread and open ticket ' +
          'channel. Attachment files are not included.\n\n' +
          "If the archive can't be delivered, the reset stops and nothing is deleted.",
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
            ? 'Your data archive will be sent to your DMs before deletion. If that fails, nothing is deleted.\n\n'
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
              ? 'Compiling archive (including transcripts) and cleaning up. This may take a few minutes.'
              : 'Cleaning up. This may take a moment.',
          ),
      ],
      components: [],
    });

    // Spend the day's reset now (blocks a concurrent second run); given back unless the reset finishes.
    if (!rateLimiter.check(rateLimitKey, BOT_RESET_LIMIT).allowed) {
      await interaction.editReply({ content: BOT_RESET_LIMIT.message, embeds: [], components: [] });
      return;
    }
    let completed = false;
    try {
      completed = await executeReset(client, interaction, guildId, saveData, deps);
    } finally {
      if (!completed) rateLimiter.reset(rateLimitKey);
    }
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

async function showAborted(
  interaction: ChatInputCommandInteraction<CacheType>,
  title: string,
  description: string,
): Promise<void> {
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(Colors.severity.high).setTitle(title).setDescription(description)],
    components: [],
  });
}

function formatKeptChannels(ids: string[], saveData: boolean): string {
  const listed = ids.slice(0, MAX_KEPT_LISTED).map(id => `<#${id}>`);
  if (ids.length > MAX_KEPT_LISTED) listed.push(`+${ids.length - MAX_KEPT_LISTED} more`);
  const why = saveData
    ? "Not in the archive (couldn't be read, or opened or updated after it was made) or couldn't be deleted"
    : "Couldn't be deleted";
  return `${why}, so they were left alone. Review and delete them by hand:\n${listed.join(' ')}`;
}

/**
 * Show the final summary. A big reset can outlast the 15-minute interaction
 * token, so fall back to a DM; the reset itself has already finished.
 */
async function deliverSummary(interaction: ChatInputCommandInteraction<CacheType>, embed: EmbedBuilder) {
  try {
    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    enhancedLogger.warn('Could not show the reset summary; sending it by DM', LogCategory.COMMAND_EXECUTION, {
      guildId: interaction.guildId,
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.user.send({ embeds: [embed] }).catch(() => undefined);
  }
}

/** What the summary says about the purge, and whether it finished. */
function describePurge(purge: Awaited<ReturnType<typeof deleteAllGuildData>>): { complete: boolean; value: string } {
  if (!purge.success) {
    return { complete: false, value: "Couldn't start the purge, so no records were deleted" };
  }
  if (purge.failed.length === 0) {
    return { complete: true, value: `${purge.total} records purged from ${purge.tables} tables` };
  }
  const listed = purge.failed.slice(0, MAX_FAILED_LISTED);
  if (purge.failed.length > MAX_FAILED_LISTED) listed.push(`+${purge.failed.length - MAX_FAILED_LISTED} more`);
  return {
    complete: false,
    value: `${purge.total} records purged, but ${purge.failed.length} of ${purge.tables} tables failed: ${listed.join(', ')}`,
  };
}

/**
 * Execute the actual reset: optional archive DM (abort on failure, before
 * anything is deleted), thread/channel/message cleanup (after a saved archive,
 * only what it holds), cache clears, DB purge, setup-command re-registration,
 * and summary embed. Returns true only when the whole purge finished, so the
 * caller gives the daily limit back otherwise.
 */
async function executeReset(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  guildId: string,
  saveData: boolean,
  deps: BotResetDeps,
): Promise<boolean> {
  // Set just before the first deletion, so an error before it can say that nothing was deleted.
  let deletionStarted = false;
  try {
    let sizeFormatted = '';
    let cleanupOptions: CleanupOptions = {};

    // 1. Compile and send archive (if user chose to save). Every failure here aborts before any deletion.
    if (saveData) {
      // The deadline counts from the slash command, whose token expires 15 minutes after it.
      const commandAt = interaction.createdTimestamp ?? Date.now();
      const archive = await deps.compileGuildArchive(guildId, client, {
        deadline: commandAt + TRANSCRIPT_CAPTURE_BUDGET_MS,
      });
      sizeFormatted = formatBytes(archive.stats.compressedSizeBytes);

      if (archive.stats.compressedSizeBytes > MAX_EXPORT_ATTACHMENT_BYTES) {
        enhancedLogger.warn(`Archive too large for DM: ${sizeFormatted}`, LogCategory.COMMAND_EXECUTION, { guildId });
        await showAborted(
          interaction,
          'Archive Too Large',
          `The archive is ${sizeFormatted}, over Discord's 8 MB DM limit, and can't be split into parts yet, so ` +
            'nothing was deleted.\n\n' +
            'If most of it is archived tickets or applications, export and clear those (with their transcripts) using ' +
            '`/archive cleanup`, then run `/bot-reset` again.\n\n' +
            "`/archive cleanup` can't shrink memory items, XP, activity, analytics or log data. If that is most of it, " +
            'run `/bot-reset` with **No, Delete Everything** (nothing is saved), or contact support. `/data-export` ' +
            'skips transcripts, so it is smaller and may fit under the same 8 MB limit: try it first to save the tables.',
        );
        return false;
      }

      try {
        const attachment = new AttachmentBuilder(archive.buffer, {
          name: archive.filename,
        });
        await interaction.user.send({
          content: `**Cogworks Archive** for ${interaction.guild!.name}\n${archive.stats.totalEntries} entries + ${archive.stats.transcripts} transcripts (${sizeFormatted} compressed)\nTickets: ${archive.stats.archivedTickets} | Applications: ${archive.stats.archivedApplications} | Memory: ${archive.stats.memoryItems}`,
          files: [attachment],
        });
      } catch {
        enhancedLogger.warn('Failed to DM archive to admin; reset aborted', LogCategory.COMMAND_EXECUTION, {
          guildId,
          userId: interaction.user.id,
        });
        await showAborted(
          interaction,
          'Reset Aborted',
          "Couldn't send the archive to your DMs, so nothing was deleted. Turn on DMs from server members " +
            '(or save your data with `/data-export` first), then run `/bot-reset` again.',
        );
        return false;
      }

      // Delete only what the archive holds: anything unreadable, opened or updated since stays in Discord.
      cleanupOptions = { exported: archive.coverage };
    }

    // 2. Clean up messages, threads and open ticket/application channels
    deletionStarted = true;
    const cleanup = await deps.cleanupGuildMessages(client, guildId, cleanupOptions);

    // 3. Clear caches. deleteAllGuildData drops the other per-guild caches itself; the bait
    //    caches live on the client, so clear them here, on both sides of the purge.
    invalidateBaitCaches(client, guildId);

    // 4. Purge database
    const purgeResult = await deps.deleteAllGuildData(guildId);
    invalidateBaitCaches(client, guildId); // a message handled mid-purge may have re-cached the config
    const purge = describePurge(purgeResult);
    // Audited here, not by the dispatcher, so a cancelled or aborted reset leaves no row. Written after
    // the purge, which deletes the guild's earlier audit rows.
    void writeAuditLog(guildId, 'command:bot-reset', interaction.user.id, { complete: purge.complete }, 'command');

    // 5. Re-register commands. Must follow the purge: with no config rows left, only the
    //    always-visible set (/bot-setup and every *-setup command) is registered.
    let commandsReset = false;
    try {
      clearGuildCommandSignature(guildId); // cancel any pending debounced refresh
      await deps.registerGuildCommands(guildId);
      commandsReset = true;
    } catch (error) {
      enhancedLogger.warn('Failed to re-register guild commands during reset', LogCategory.COMMAND_EXECUTION, {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 6. Show summary
    const summaryFields = [
      {
        name: 'Discord Cleanup',
        value: `${cleanup.deleted} messages, threads and channels deleted`,
        inline: true,
      },
      {
        name: 'Database',
        value: purge.value,
        inline: true,
      },
      {
        name: 'Commands',
        value: commandsReset
          ? 'Reset to the setup commands'
          : "Couldn't refresh the command list, so module commands may still show until the bot restarts. " +
            '`/bot-setup` is still available.',
        inline: true,
      },
    ];

    if (saveData) {
      summaryFields.unshift({
        name: 'Archive',
        value: `Sent to your DMs (${sizeFormatted})`,
        inline: true,
      });
    }

    if (cleanup.keptChannelIds.length > 0) {
      summaryFields.push({
        name: 'Left in place',
        value: formatKeptChannels(cleanup.keptChannelIds, saveData),
        inline: false,
      });
    }

    const summaryEmbed = purge.complete
      ? new EmbedBuilder()
          .setColor(Colors.status.success)
          .setTitle('Factory Reset Complete')
          .addFields(summaryFields)
          .setFooter({ text: 'Run /bot-setup to reconfigure Cogworks for this server.' })
      : new EmbedBuilder()
          .setColor(Colors.severity.high)
          .setTitle('Factory Reset Incomplete')
          .setDescription(
            "Some Cogworks data couldn't be deleted, so this reset doesn't count toward the daily limit. " +
              'Run `/bot-reset` again to finish, and contact support if it keeps failing.',
          )
          .addFields(summaryFields);

    await deliverSummary(interaction, summaryEmbed);

    const logContext = {
      guildId,
      userId: interaction.user.id,
      dataSaved: saveData,
      messagesDeleted: cleanup.deleted,
      channelsKept: cleanup.keptChannelIds.length,
      recordsPurged: purgeResult.total,
      failedTables: purgeResult.failed,
    };
    if (purge.complete) {
      enhancedLogger.info('Guild factory reset completed', LogCategory.COMMAND_EXECUTION, logContext);
    } else {
      enhancedLogger.warn('Guild factory reset incomplete', LogCategory.COMMAND_EXECUTION, logContext);
    }
    return purge.complete;
  } catch (error) {
    enhancedLogger.error('Factory reset execution failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
      deletionStarted,
    });
    await interaction
      .editReply({
        content: deletionStarted
          ? 'An error occurred during reset. Some data may have been partially deleted. Run `/bot-reset` again ' +
            'to finish, and contact support if it keeps failing.'
          : 'An error occurred before anything was deleted, so nothing was deleted. Please try again.',
        embeds: [],
        components: [],
      })
      .catch(() => undefined); // token may have expired; the error is logged above
    return false;
  }
}
