import {
  type CacheType,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Client,
  type ForumChannel,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import {
  buildConfigStatusEmbed,
  cleanupOldMessage,
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  lang,
  RateLimits,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import type { ConfigItem } from '../../../utils/setup/configStatusEmbed';
import { buildApplicationMessage } from './applicationPosition';

const tl = lang.application.setup;
const applicationConfigRepo = lazyRepo(ApplicationConfig);
const archivedApplicationConfigRepo = lazyRepo(ArchivedApplicationConfig);
const positionRepo = lazyRepo(Position);

/** Set up or re-setup the application channel: send position message and update config. */
async function setupApplicationChannel(
  channelOption: TextChannel,
  applicationConfig: ApplicationConfig | null,
  guildId: string,
  guild: ChatInputCommandInteraction<CacheType>['guild'] & {},
): Promise<ApplicationConfig> {
  const activePositions = await positionRepo.find({
    where: { guildId, isActive: true },
    order: { displayOrder: 'ASC' },
  });

  const { content, components } = await buildApplicationMessage(activePositions);

  if (applicationConfig?.messageId) {
    await cleanupOldMessage(guild, applicationConfig.channelId, applicationConfig.messageId);
  }

  const msg = await channelOption.send({ content, components });

  if (!applicationConfig) {
    applicationConfig = applicationConfigRepo.create({
      guildId,
      messageId: msg.id,
      channelId: channelOption.id,
    });
  } else {
    applicationConfig.channelId = channelOption.id;
    applicationConfig.messageId = msg.id;
  }

  await applicationConfigRepo.save(applicationConfig);

  enhancedLogger.info(`Application channel configured to ${channelOption.name}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    channelId: channelOption.id,
  });

  return applicationConfig;
}

/** Set up the application archive forum: create welcome thread and update config. */
async function setupApplicationArchive(
  archiveOption: ForumChannel,
  archivedApplicationConfig: ArchivedApplicationConfig | null,
  guildId: string,
): Promise<ArchivedApplicationConfig> {
  const thread = await archiveOption.threads.create({
    name: 'Application Archive',
    message: { content: tl.archiveInitialMsg },
  });

  try {
    await thread.pin();
  } catch {
    enhancedLogger.info('Could not pin archive thread (max pins may be reached)', LogCategory.SYSTEM);
  }

  if (!archivedApplicationConfig) {
    archivedApplicationConfig = archivedApplicationConfigRepo.create({
      guildId,
      messageId: thread.id,
      channelId: archiveOption.id,
    });
  } else {
    archivedApplicationConfig.channelId = archiveOption.id;
    archivedApplicationConfig.messageId = thread.id;
  }

  await archivedApplicationConfigRepo.save(archivedApplicationConfig);

  enhancedLogger.info(`Application archive configured to ${archiveOption.name}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    channelId: archiveOption.id,
  });

  return archivedApplicationConfig;
}

/** Set up the application category: store category ID in config. */
async function setupApplicationCategory(
  categoryOption: CategoryChannel,
  applicationConfig: ApplicationConfig | null,
  guildId: string,
): Promise<ApplicationConfig> {
  if (!applicationConfig) {
    applicationConfig = applicationConfigRepo.create({
      guildId,
      messageId: '',
      channelId: '',
      categoryId: categoryOption.id,
    });
  } else {
    applicationConfig.categoryId = categoryOption.id;
  }

  await applicationConfigRepo.save(applicationConfig);

  enhancedLogger.info(`Application category configured to ${categoryOption.name}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    categoryId: categoryOption.id,
  });

  return applicationConfig;
}

/** Build the config status embed summarizing current application setup state. */
function buildApplicationStatusEmbed(
  applicationConfig: ApplicationConfig | null,
  archivedApplicationConfig: ArchivedApplicationConfig | null,
  hasUpdates: boolean,
) {
  const items: ConfigItem[] = [
    {
      label: 'Channel',
      value: applicationConfig?.channelId ? `<#${applicationConfig.channelId}>` : null,
      missingDescription: tl.missingChannel,
    },
    {
      label: 'Archive',
      value: archivedApplicationConfig?.channelId ? `<#${archivedApplicationConfig.channelId}>` : null,
      missingDescription: tl.missingArchive,
    },
    {
      label: 'Category',
      value: applicationConfig?.categoryId ? `<#${applicationConfig.categoryId}>` : null,
      missingDescription: tl.missingCategory,
    },
  ];

  return buildConfigStatusEmbed({
    systemName: tl.statusTitle,
    items,
    hasUpdates,
  });
}

export async function applicationSetupHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'application-setup',
    limit: RateLimits.APPLICATION_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;
  const guild = interaction.guild!;

  // Get provided options (all optional)
  const channelOption = interaction.options.getChannel('channel') as TextChannel | null;
  const archiveOption = interaction.options.getChannel('archive') as ForumChannel | null;
  const categoryOption = interaction.options.getChannel('category') as CategoryChannel | null;

  const hasAnyOption = channelOption || archiveOption || categoryOption;

  // Load existing configs
  let applicationConfig = await applicationConfigRepo.findOneBy({ guildId });
  let archivedApplicationConfig = await archivedApplicationConfigRepo.findOneBy({ guildId });

  try {
    if (channelOption) {
      applicationConfig = await setupApplicationChannel(channelOption, applicationConfig, guildId, guild);
    }

    if (archiveOption) {
      archivedApplicationConfig = await setupApplicationArchive(archiveOption, archivedApplicationConfig, guildId);
    }

    if (categoryOption) {
      applicationConfig = await setupApplicationCategory(categoryOption, applicationConfig, guildId);
    }

    const statusEmbed = buildApplicationStatusEmbed(applicationConfig, archivedApplicationConfig, !!hasAnyOption);

    await interaction.reply({
      embeds: [statusEmbed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.error('Application setup failed', error as Error, LogCategory.COMMAND_EXECUTION, { guildId });
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
