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
import { enhancedLogger, LogCategory, lang } from '../../utils';
import { archiveAndCloseApplication } from '../../utils/application/closeWorkflow';
import { lazyRepo } from '../../utils/database/lazyRepo';

const tl = lang.application.close;
const applicationRepo = lazyRepo(Application);
const archivedApplicationConfigRepo = lazyRepo(ArchivedApplicationConfig);

export const applicationCloseEvent = async (client: Client, interaction: ButtonInteraction) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const channel = interaction.channel as GuildTextBasedChannel;
  const channelId = interaction.channelId || '';
  const archivedConfig = await archivedApplicationConfigRepo.findOneBy({ guildId });
  const application = await applicationRepo.findOneBy({ guildId, channelId });

  if (!archivedConfig) {
    enhancedLogger.warn(lang.application.applicationConfigNotFound, LogCategory.SYSTEM, { guildId });
    return;
  }

  if (!application) {
    enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.SYSTEM, { guildId, channelId });
    return;
  }

  // Prevent duplicate close (double-click race condition)
  if (application.status === 'closed') {
    enhancedLogger.warn('Application already closed, skipping duplicate archive', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return;
  }

  await applicationRepo.update({ id: application.id, guildId }, { status: 'closed' });

  const result = await archiveAndCloseApplication(client, application, guildId, channel, archivedConfig.channelId);

  if (result.transcriptFailed && !interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: tl.transcriptCreate.error,
      flags: [MessageFlags.Ephemeral],
    });
  } else if (result.success && !result.archived) {
    enhancedLogger.warn('Application closed but archive post failed', LogCategory.SYSTEM, {
      guildId,
      channelId,
      applicationId: application.id,
    });
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
