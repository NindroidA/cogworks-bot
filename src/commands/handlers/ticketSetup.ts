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
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import {
  buildConfigStatusEmbed,
  cleanupOldMessage,
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  lang,
  RateLimits,
} from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';
import type { ConfigItem } from '../../utils/setup/configStatusEmbed';

const tl = lang.ticketSetup;
const ticketConfigRepo = lazyRepo(TicketConfig);
const archivedTicketConfigRepo = lazyRepo(ArchivedTicketConfig);

/** Set up or re-setup the ticket creation channel: send button message and update config. */
async function setupTicketChannel(
  channelOption: TextChannel,
  ticketConfig: TicketConfig | null,
  guildId: string,
  guild: ChatInputCommandInteraction<CacheType>['guild'] & {},
): Promise<TicketConfig> {
  const createTicketButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
    new ButtonBuilder()
      .setCustomId('create_ticket')
      .setEmoji('🎫')
      .setLabel(lang.general.buttons.createTicket)
      .setStyle(ButtonStyle.Primary),
  );

  if (ticketConfig?.messageId) {
    await cleanupOldMessage(guild, ticketConfig.channelId, ticketConfig.messageId);
  }

  const msg = await channelOption.send({
    content: tl.createTicket,
    components: [createTicketButton],
  });

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

  enhancedLogger.info(`Ticket channel configured to ${channelOption.name}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    channelId: channelOption.id,
  });

  return ticketConfig;
}

/** Set up the ticket archive forum: create welcome thread and update config. */
async function setupTicketArchive(
  archiveOption: ForumChannel,
  archivedTicketConfig: ArchivedTicketConfig | null,
  guildId: string,
): Promise<ArchivedTicketConfig> {
  const thread = await archiveOption.threads.create({
    name: 'Ticket Archive',
    message: { content: tl.archiveInitialMsg },
  });

  try {
    await thread.pin();
  } catch {
    enhancedLogger.info('Could not pin archive thread (max pins may be reached)', LogCategory.SYSTEM);
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

  enhancedLogger.info(`Ticket archive configured to ${archiveOption.name}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    channelId: archiveOption.id,
  });

  return archivedTicketConfig;
}

/** Set up the ticket category: store category ID in config. */
async function setupTicketCategory(
  categoryOption: CategoryChannel,
  ticketConfig: TicketConfig | null,
  guildId: string,
): Promise<TicketConfig> {
  if (!ticketConfig) {
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

  enhancedLogger.info(`Ticket category configured to ${categoryOption.name}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    categoryId: categoryOption.id,
  });

  return ticketConfig;
}

/** Build the config status embed summarizing current ticket setup state. */
function buildTicketStatusEmbed(
  ticketConfig: TicketConfig | null,
  archivedTicketConfig: ArchivedTicketConfig | null,
  hasUpdates: boolean,
) {
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

  return buildConfigStatusEmbed({
    systemName: tl.statusTitle,
    items,
    hasUpdates,
  });
}

export async function ticketSetupHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'ticket-setup',
    limit: RateLimits.TICKET_SETUP,
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
  let ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
  let archivedTicketConfig = await archivedTicketConfigRepo.findOneBy({
    guildId,
  });

  try {
    if (channelOption) {
      ticketConfig = await setupTicketChannel(channelOption, ticketConfig, guildId, guild);
    }

    if (archiveOption) {
      archivedTicketConfig = await setupTicketArchive(archiveOption, archivedTicketConfig, guildId);
    }

    if (categoryOption) {
      ticketConfig = await setupTicketCategory(categoryOption, ticketConfig, guildId);
    }

    const statusEmbed = buildTicketStatusEmbed(ticketConfig, archivedTicketConfig, !!hasAnyOption);

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
}
