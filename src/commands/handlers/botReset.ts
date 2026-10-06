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
import { Colors } from '../../utils/colors';
import { deleteAllGuildData } from '../../utils/database/guildQueries';
import { compileGuildArchive } from '../../utils/offboarding/archiveCompiler';
import { invalidateBaitCaches } from '../../utils/offboarding/guildCaches';
import { MAX_EXPORT_ATTACHMENT_BYTES } from '../../utils/offboarding/guildDataExport';
import { cleanupGuildMessages } from '../../utils/offboarding/messageCleanup';
import { clearGuildCommandSignature, registerGuildCommands } from '../../utils/setup/commandGating';

const STAGE_TIMEOUT_MS = 60_000;
const FINAL_STAGE_TIMEOUT_MS = 30_000;
/** How many failed tables the summary names before "+N more". */
const MAX_FAILED_LISTED = 10;

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
          '- All archived tickets and applications\n' +
          '- All memory items and tags\n' +
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
          'The archive includes all tickets, applications, memory items, XP data, and configurations in a compressed JSON file.\n\n' +
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
              ? 'Compiling archive and cleaning up. This may take a moment.'
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
 * anything is deleted), message cleanup, cache clears, DB purge,
 * setup-command re-registration, and summary embed. Returns true only when the
 * whole purge finished, so the caller gives the daily limit back otherwise.
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

    // 1. Compile and send archive (if user chose to save). Every failure here aborts before any deletion.
    if (saveData) {
      const archive = await deps.compileGuildArchive(guildId);
      sizeFormatted = formatBytes(archive.stats.compressedSizeBytes);

      if (archive.stats.compressedSizeBytes > MAX_EXPORT_ATTACHMENT_BYTES) {
        enhancedLogger.warn(`Archive too large for DM: ${sizeFormatted}`, LogCategory.COMMAND_EXECUTION, { guildId });
        await showAborted(
          interaction,
          'Archive Too Large',
          `The archive is ${sizeFormatted}, which exceeds Discord's 8 MB DM limit, so nothing was deleted. ` +
            'To shrink it, export and clear old ticket and application archives with `/archive cleanup`, then run ' +
            '`/bot-reset` again. Or save your data with `/data-export`, then run `/bot-reset` with **No, Delete Everything**.',
        );
        return false;
      }

      try {
        const attachment = new AttachmentBuilder(archive.buffer, {
          name: archive.filename,
        });
        await interaction.user.send({
          content: `**Cogworks Archive** for ${interaction.guild!.name}\n${archive.stats.totalEntries} entries (${sizeFormatted} compressed)\nTickets: ${archive.stats.archivedTickets} | Applications: ${archive.stats.archivedApplications} | Memory: ${archive.stats.memoryItems}`,
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
    }

    // 2. Clean up messages
    deletionStarted = true;
    const cleanup = await deps.cleanupGuildMessages(client, guildId);

    // 3. Clear caches. deleteAllGuildData drops the other per-guild caches itself; the bait
    //    caches live on the client, so clear them here, on both sides of the purge.
    invalidateBaitCaches(client, guildId);

    // 4. Purge database
    const purgeResult = await deps.deleteAllGuildData(guildId);
    invalidateBaitCaches(client, guildId); // a message handled mid-purge may have re-cached the config
    const purge = describePurge(purgeResult);

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
        name: 'Messages Cleaned',
        value: `${cleanup.deleted} deleted`,
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

    await interaction.editReply({ embeds: [summaryEmbed], components: [] });

    const logContext = {
      guildId,
      userId: interaction.user.id,
      dataSaved: saveData,
      messagesDeleted: cleanup.deleted,
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
