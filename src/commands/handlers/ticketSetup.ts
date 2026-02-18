import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type CacheType,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Client,
  type ForumChannel,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
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
} from '../../utils';
import type { ConfigItem } from '../../utils/setup/configStatusEmbed';

const tl = lang.ticketSetup;
const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);

export const ticketSetupHandler = async (
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

  // Rate limit check (10 ticket setups per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(interaction.guildId!, 'ticket-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.TICKET_SETUP);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.info(
      `Rate limit exceeded for ticket setup in guild ${interaction.guildId}`,
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
  let ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
  let archivedTicketConfig = await archivedTicketConfigRepo.findOneBy({
    guildId,
  });

  try {
    // ── Channel setup ──────────────────────────────────────────────
    if (channelOption) {
      const createTicketButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket')
          .setEmoji('🎫')
          .setLabel('Create Ticket')
          .setStyle(ButtonStyle.Primary),
      );

      const mainMsg = {
        content: tl.createTicket,
        components: [createTicketButton],
      };

      // Clean up old message (always, even on same-channel re-setup)
      if (ticketConfig?.messageId) {
        await cleanupOldMessage(guild, ticketConfig.channelId, ticketConfig.messageId);
      }

      // Send new message
      const msg = await channelOption.send(mainMsg);

      if (!ticketConfig) {
        ticketConfig = ticketConfigRepo.create({
          guildId,
          messageId: msg.id,
          channelId: channelOption.id,
        });
      } else {
        ticketConfig.channelId = channelOption.id;
        ticketConfig.messageId = msg.id;
      }

      await ticketConfigRepo.save(ticketConfig);

      enhancedLogger.info(
        `Ticket channel configured to ${channelOption.name}`,
        LogCategory.COMMAND_EXECUTION,
        { guildId, channelId: channelOption.id },
      );
    }

    // ── Archive setup ──────────────────────────────────────────────
    if (archiveOption) {
      // Create welcome thread in new forum
      const thread = await archiveOption.threads.create({
        name: 'Ticket Archive',
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

      if (!archivedTicketConfig) {
        archivedTicketConfig = archivedTicketConfigRepo.create({
          guildId,
          messageId: thread.id,
          channelId: archiveOption.id,
        });
      } else {
        archivedTicketConfig.channelId = archiveOption.id;
        archivedTicketConfig.messageId = thread.id;
      }

      await archivedTicketConfigRepo.save(archivedTicketConfig);

      enhancedLogger.info(
        `Ticket archive configured to ${archiveOption.name}`,
        LogCategory.COMMAND_EXECUTION,
        { guildId, channelId: archiveOption.id },
      );
    }

    // ── Category setup ─────────────────────────────────────────────
    if (categoryOption) {
      if (!ticketConfig) {
        // Create a minimal config so category can be stored
        ticketConfig = ticketConfigRepo.create({
          guildId,
          messageId: '',
          channelId: '',
          categoryId: categoryOption.id,
        });
      } else {
        ticketConfig.categoryId = categoryOption.id;
      }

      await ticketConfigRepo.save(ticketConfig);

      enhancedLogger.info(
        `Ticket category configured to ${categoryOption.name}`,
        LogCategory.COMMAND_EXECUTION,
        { guildId, categoryId: categoryOption.id },
      );
    }

    // ── Build status embed ─────────────────────────────────────────
    const items: ConfigItem[] = [
      {
        label: 'Channel',
        value: ticketConfig?.channelId ? `<#${ticketConfig.channelId}>` : null,
        missingDescription: tl.missingChannel,
      },
      {
        label: 'Archive',
        value: archivedTicketConfig?.channelId ? `<#${archivedTicketConfig.channelId}>` : null,
        missingDescription: tl.missingArchive,
      },
      {
        label: 'Category',
        value: ticketConfig?.categoryId ? `<#${ticketConfig.categoryId}>` : null,
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
    enhancedLogger.error('Ticket setup failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
