import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  type GuildTextBasedChannel,
  MessageFlags,
} from 'discord.js';
import { Application } from '../../typeorm/entities/application/Application';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { claimClose, enhancedLogger, LogCategory, lang, releaseClose, replyEphemeralError } from '../../utils';
import { type ArchiveApplicationResult, archiveAndCloseApplication } from '../../utils/application/closeWorkflow';
import { lazyRepo } from '../../utils/database/lazyRepo';

const tl = lang.application.close;
const applicationRepo = lazyRepo(Application);
const archivedApplicationConfigRepo = lazyRepo(ArchivedApplicationConfig);

export const applicationCloseEvent = async (client: Client, interaction: ButtonInteraction) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const channel = interaction.channel as GuildTextBasedChannel;
  const channelId = interaction.channelId || '';
  const archivedConfig = await archivedApplicationConfigRepo.findOneBy({
    guildId,
  });
  const application = await applicationRepo.findOneBy({ guildId, channelId });

  // Every early return below runs AFTER confirmCloseApplication already showed
  // "Closing application..." (interaction.update). A bare return freezes that
  // message forever (the close-button hang). Each guard surfaces an ephemeral
  // followUp before bailing — mirrors the ticket close flow.
  if (!archivedConfig) {
    enhancedLogger.warn(lang.application.applicationConfigNotFound, LogCategory.SYSTEM, { guildId });
    await replyEphemeralError(interaction, tl.notConfigured);
    return;
  }

  if (!application) {
    enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.SYSTEM, { guildId, channelId });
    await replyEphemeralError(interaction, tl.notFound);
    return;
  }

  // Prevent duplicate close (double-click race condition)
  if (application.status === 'closed') {
    enhancedLogger.warn('Application already closed, skipping duplicate archive', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    await replyEphemeralError(interaction, tl.alreadyClosed);
    return;
  }

  // Atomic flip — the status guard above is check-then-set, so a button
  // confirm racing the dashboard's archive (or a double-click) could pass it;
  // whoever loses the conditional UPDATE bails as a duplicate. Mirrors
  // events/ticket/close.ts.
  if (!(await claimClose(applicationRepo, application.id, guildId))) {
    enhancedLogger.warn(
      'Application close lost the flip race — concurrent close already in progress',
      LogCategory.SYSTEM,
      { guildId, channelId },
    );
    await replyEphemeralError(interaction, tl.alreadyClosed);
    return;
  }

  let result: ArchiveApplicationResult;
  try {
    result = await archiveAndCloseApplication(client, application, guildId, channel, archivedConfig.channelId);
  } catch (error) {
    // Unexpected throw escaped the workflow. Status was flipped to 'closed'
    // above but the channel still exists — revert (otherwise the dup-close guard
    // strands it) and tell the user instead of leaving "Closing application...".
    await releaseClose(applicationRepo, application.id, guildId, application.status);
    enhancedLogger.error(
      'Application close threw unexpectedly — status reverted, channel preserved for retry',
      error instanceof Error ? error : undefined,
      LogCategory.ERROR,
      { guildId, channelId, applicationId: application.id },
    );
    await replyEphemeralError(interaction, tl.transcriptCreate.error).catch(() => {});
    return;
  }

  if (!result.archived) {
    // Close did not complete (transcript fetch or forum post failed). The
    // workflow preserved the channel; revert the status so the close can be
    // retried instead of stranding a 'closed' application with a live channel.
    await releaseClose(applicationRepo, application.id, guildId, application.status);
    enhancedLogger.warn(
      'Application close reverted — archive failed, channel + application preserved for retry',
      LogCategory.SYSTEM,
      {
        guildId,
        channelId,
        applicationId: application.id,
        transcriptFailed: result.transcriptFailed ?? false,
      },
    );
    // replyEphemeralError picks reply/editReply/followUp from the interaction
    // state internally, so no branch on replied/deferred is needed.
    await replyEphemeralError(interaction, tl.transcriptCreate.error).catch((err: unknown) => {
      enhancedLogger.error(
        'Failed to deliver application-close failure notice to the user',
        err instanceof Error ? err : undefined,
        LogCategory.SYSTEM,
        { guildId, channelId, applicationId: application.id },
      );
    });
  } else if (result.channelDeleted === false) {
    // Archived OK, but Discord refused to delete the channel — surface it so the
    // "Closing application..." ack doesn't sit forever on a live channel.
    enhancedLogger.warn('Application archived but channel delete failed — notifying user', LogCategory.SYSTEM, {
      guildId,
      channelId,
      applicationId: application.id,
    });
    await replyEphemeralError(interaction, tl.archivedChannelRemains, { bugReport: true }).catch(() => {});
  }
};

export const closeApplicationButton = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: close_application`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('confirm_close_application').setLabel(tl.closingL).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_close_application').setLabel(tl.cancelL).setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: tl.confirm,
    components: [confirmRow],
    flags: [MessageFlags.Ephemeral],
  });
};

export const confirmCloseApplication = async (client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: confirm_close_application`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.closing, components: [] });
  await applicationCloseEvent(client, interaction);
};

export const cancelCloseApplication = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: cancel_close_application`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.cancel, components: [] });
};
