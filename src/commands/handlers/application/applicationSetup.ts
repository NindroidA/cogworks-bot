import {
  type CacheType,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Client,
  type ForumChannel,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import {
  buildConfigStatusEmbed,
  cleanupOldMessage,
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';
import type { ConfigItem } from '../../../utils/setup/configStatusEmbed';
import { buildApplicationMessage } from './applicationPosition';

const tl = lang.application.setup;
const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
const archivedApplicationConfigRepo = AppDataSource.getRepository(ArchivedApplicationConfig);
const positionRepo = AppDataSource.getRepository(Position);

export const applicationSetupHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  // Require admin permissions (check .allowed — object is always truthy)
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message!,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Rate limit check (10 application setups per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(interaction.guildId!, 'application-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.APPLICATION_SETUP);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.info(
      `Rate limit exceeded for application setup in guild ${interaction.guildId}`,
      LogCategory.SECURITY,
    );
    return;
  }

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
    // ── Channel setup ──────────────────────────────────────────────
    if (channelOption) {
      // Get active positions for the application channel message
      const activePositions = await positionRepo.find({
        where: { guildId, isActive: true },
        order: { displayOrder: 'ASC' },
      });

      const { content, components } = await buildApplicationMessage(activePositions);

      // Clean up old message (always, even on same-channel re-setup)
      if (applicationConfig?.messageId) {
        await cleanupOldMessage(guild, applicationConfig.channelId, applicationConfig.messageId);
      }

      // Send new message
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

      enhancedLogger.info(
        `Application channel configured to ${channelOption.name}`,
        LogCategory.COMMAND_EXECUTION,
        { guildId, channelId: channelOption.id },
      );
    }

    // ── Archive setup ──────────────────────────────────────────────
    if (archiveOption) {
      const thread = await archiveOption.threads.create({
        name: 'Application Archive',
        message: { content: tl.archiveInitialMsg },
      });

      try {
        await thread.pin();
      } catch {
        enhancedLogger.info(
          'Could not pin archive thread (max pins may be reached)',
          LogCategory.SYSTEM,
        );
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

      enhancedLogger.info(
        `Application archive configured to ${archiveOption.name}`,
        LogCategory.COMMAND_EXECUTION,
        { guildId, channelId: archiveOption.id },
      );
    }

    // ── Category setup ─────────────────────────────────────────────
    if (categoryOption) {
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

      enhancedLogger.info(
        `Application category configured to ${categoryOption.name}`,
        LogCategory.COMMAND_EXECUTION,
        { guildId, categoryId: categoryOption.id },
      );
    }

    // ── Build status embed ─────────────────────────────────────────
    const items: ConfigItem[] = [
      {
        label: 'Channel',
        value: applicationConfig?.channelId ? `<#${applicationConfig.channelId}>` : null,
        missingDescription: tl.missingChannel,
      },
      {
        label: 'Archive',
        value: archivedApplicationConfig?.channelId
          ? `<#${archivedApplicationConfig.channelId}>`
          : null,
        missingDescription: tl.missingArchive,
      },
      {
        label: 'Category',
        value: applicationConfig?.categoryId ? `<#${applicationConfig.categoryId}>` : null,
        missingDescription: tl.missingCategory,
      },
    ];

    const statusEmbed = buildConfigStatusEmbed({
      systemName: tl.statusTitle,
      items,
      hasUpdates: !!hasAnyOption,
    });

    await interaction.reply({
      embeds: [statusEmbed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.error(
      'Application setup failed',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
