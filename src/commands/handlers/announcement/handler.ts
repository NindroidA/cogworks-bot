/**
 * Announcement Handler
 *
 * Supports both legacy subcommands (maintenance, back-online, etc.) and the
 * new template-based send flow (/announcement send <template>).
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  NewsChannel,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from '../../../typeorm/entities/announcement/AnnouncementLog';
import { AnnouncementTemplate } from '../../../typeorm/entities/announcement/AnnouncementTemplate';
import {
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  lang,
  parseTimeInput,
  RateLimits,
  showAndAwaitModal,
} from '../../../utils';
import {
  detectDynamicPlaceholders,
  renderTemplate,
  type TemplatePlaceholderParams,
} from '../../../utils/announcement/templateEngine';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { sanitizeUserInput } from '../../../utils/validation/inputSanitizer';

const announcementConfigRepo = lazyRepo(AnnouncementConfig);
const announcementLogRepo = lazyRepo(AnnouncementLog);
const templateRepo = lazyRepo(AnnouncementTemplate);

// Map legacy subcommand names to default template names
const LEGACY_TEMPLATE_MAP: Record<string, string> = {
  maintenance: 'maintenance',
  'maintenance-scheduled': 'maintenance-scheduled',
  'back-online': 'back-online',
  'update-scheduled': 'update-scheduled',
  'update-complete': 'update-complete',
};

/**
 * Main announcement handler
 */
export async function announcementHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const tl = lang.announcement;
  const tlErr = lang.errors;
  const subCommand = interaction.options.getSubcommand();
  const _subcommandGroup = interaction.options.getSubcommandGroup(false);
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  try {
    // Permission + rate limit check
    const guard = await guardAdminRateLimit(interaction, {
      action: 'announcement-create',
      limit: RateLimits.ANNOUNCEMENT_CREATE,
      scope: 'user',
    });
    if (!guard.allowed) return;

    // Config check
    const config = await announcementConfigRepo.findOneBy({ guildId });
    if (!config) {
      await interaction.reply({
        content: tl.setup.notConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Route: template subcommand group is handled by templateHandler
    // This handler only handles 'send' and legacy subcommands

    if (subCommand === 'send') {
      await handleTemplateSend(client, interaction, config, guildId);
      return;
    }

    // Legacy subcommands map to default templates
    const legacyTemplateName = LEGACY_TEMPLATE_MAP[subCommand];
    if (legacyTemplateName) {
      await handleLegacySend(client, interaction, config, guildId, subCommand, legacyTemplateName);
      return;
    }

    await interaction.reply({
      content: tlErr.unknownSubcommand,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.error(tl.error + error, undefined, LogCategory.COMMAND_EXECUTION);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: tl.fail,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
}

/**
 * Handle the new /announcement send <template> flow
 */
async function handleTemplateSend(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  config: AnnouncementConfig,
  guildId: string,
): Promise<void> {
  const tl = lang.announcement;
  const templateName = interaction.options.getString('template', true);
  const messageOverride = interaction.options.getString('message');

  const template = await templateRepo.findOneBy({
    guildId,
    name: templateName,
  });
  if (!template) {
    await interaction.reply({
      content: tl.send.templateNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Target channel
  const targetChannel = await resolveTargetChannel(client, interaction, config);
  if (!targetChannel) return;

  // Check for dynamic placeholders
  const dynamicPlaceholders = detectDynamicPlaceholders(template);

  const params: TemplatePlaceholderParams = {};

  if (dynamicPlaceholders.length > 0) {
    // Open modal to collect placeholder values
    const modal = new ModalBuilder()
      .setCustomId(`announcement_send_params_${Date.now()}`)
      .setTitle(`${template.displayName} - Parameters`);

    // Build modal fields for needed placeholders (max 5 modal fields)
    const fields = dynamicPlaceholders.slice(0, 5);
    for (const placeholder of fields) {
      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(placeholder.name)
          .setLabel(placeholder.description)
          .setStyle(TextInputStyle.Short)
          .setRequired(placeholder.name !== 'duration')
          .setPlaceholder(placeholder.example),
      );
      modal.addComponents(row);
    }

    const modalInteraction = await showAndAwaitModal(interaction, modal);
    if (!modalInteraction) return;

    // Extract values from modal
    for (const placeholder of fields) {
      const value = modalInteraction.fields.getTextInputValue(placeholder.name).trim();
      if (!value) continue;

      if (placeholder.name === 'version') {
        params.version = value;
      } else if (placeholder.name === 'duration') {
        params.duration = value;
      } else if (placeholder.name === 'time' || placeholder.name === 'time_relative') {
        // Try parsing as a time input, otherwise treat as unix timestamp
        const parsed = parseTimeInput(value);
        if (parsed) {
          params.time = Math.floor(parsed.getTime() / 1000);
        } else {
          const unix = Number.parseInt(value, 10);
          if (!Number.isNaN(unix)) {
            params.time = unix;
          }
        }
      }
    }

    // Use modal interaction for the rest
    await previewAndSend(modalInteraction, targetChannel, template, config, guildId, params, messageOverride);
  } else {
    // No dynamic placeholders — show preview directly
    params.channelId = targetChannel.id;
    await previewAndSend(interaction, targetChannel, template, config, guildId, params, messageOverride);
  }
}

/**
 * Handle legacy subcommands by mapping to default templates.
 */
async function handleLegacySend(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  config: AnnouncementConfig,
  guildId: string,
  subCommand: string,
  templateName: string,
): Promise<void> {
  const tl = lang.announcement;

  // Load template from DB
  const template = await templateRepo.findOneBy({
    guildId,
    name: templateName,
  });

  // If not found in DB (templates not seeded yet), we still need to work
  if (!template) {
    await interaction.reply({
      content: tl.send.noTemplates,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const targetChannel = await resolveTargetChannel(client, interaction, config);
  if (!targetChannel) return;

  // Build params from legacy options
  const params: TemplatePlaceholderParams = {};
  const customMessage = interaction.options.getString('message') || undefined;

  switch (subCommand) {
    case 'maintenance': {
      const duration = interaction.options.getString('duration', true);
      params.duration = duration === 'short' ? '5-10 minutes' : 'up to 1 hour or more';
      break;
    }
    case 'maintenance-scheduled': {
      const timeInput = interaction.options.getString('time', true);
      const duration = interaction.options.getString('duration', true);
      const scheduledTime = parseTimeInput(timeInput);
      if (!scheduledTime) {
        await interaction.reply({
          content: tl.invalidTime,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      params.time = Math.floor(scheduledTime.getTime() / 1000);
      params.duration = duration === 'short' ? '5-10 minutes' : 'up to 1 hour or more';
      break;
    }
    case 'update-scheduled': {
      const version = interaction.options.getString('version', true);
      const timeInput = interaction.options.getString('time', true);
      const scheduledTime = parseTimeInput(timeInput);
      if (!scheduledTime) {
        await interaction.reply({
          content: tl.invalidTime,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      params.version = version;
      params.time = Math.floor(scheduledTime.getTime() / 1000);
      break;
    }
    case 'update-complete': {
      const version = interaction.options.getString('version', true);
      params.version = version;
      break;
    }
    case 'back-online':
      // No params needed
      break;
  }

  params.channelId = targetChannel.id;
  await previewAndSend(interaction, targetChannel, template, config, guildId, params, customMessage);
}

/**
 * Resolve the target channel from options or config default.
 */
async function resolveTargetChannel(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  config: AnnouncementConfig,
): Promise<TextChannel | NewsChannel | null> {
  const tl = lang.announcement;
  const targetChannelOption = interaction.options.getChannel('channel');
  const targetChannel = targetChannelOption
    ? targetChannelOption
    : await client.channels.fetch(config.defaultChannelId);

  if (!targetChannel || !(targetChannel instanceof TextChannel || targetChannel instanceof NewsChannel)) {
    await interaction.reply({
      content: tl.setup.invalidChannel,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  return targetChannel;
}

/**
 * Unified preview and send — renders template, shows preview buttons,
 * sends on confirm, logs to DB. Works with both command and modal interactions.
 */
async function previewAndSend(
  interaction: ChatInputCommandInteraction<CacheType> | ModalSubmitInteraction<CacheType>,
  targetChannel: TextChannel | NewsChannel,
  template: AnnouncementTemplate,
  config: AnnouncementConfig,
  guildId: string,
  params: TemplatePlaceholderParams,
  messageOverride?: string | null,
): Promise<void> {
  const roleId = config.defaultRoleId;
  const renderTemplate_ = messageOverride ? { ...template, body: sanitizeUserInput(messageOverride) } : template;
  const messageData = renderTemplate(
    renderTemplate_ as AnnouncementTemplate,
    params,
    interaction.guild,
    interaction.user,
    roleId,
  );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('announcement_send')
      .setLabel(lang.announcement.templates.sendButton)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('announcement_cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: `**Preview** (will be sent to ${targetChannel})\n---`,
    embeds: messageData.embeds,
    components: [buttons],
    flags: [MessageFlags.Ephemeral],
  });

  try {
    const buttonInteraction = await interaction.channel?.awaitMessageComponent({
      filter: (i: ButtonInteraction) =>
        i.user.id === interaction.user.id &&
        (i.customId === 'announcement_send' || i.customId === 'announcement_cancel'),
      componentType: ComponentType.Button,
      time: 120_000,
    });

    if (!buttonInteraction || buttonInteraction.customId === 'announcement_cancel') {
      await buttonInteraction?.update({
        content: lang.errors.cancelled,
        embeds: [],
        components: [],
      });
      return;
    }

    await buttonInteraction.deferUpdate();

    for (const embed of messageData.embeds) {
      embed.setTimestamp(new Date());
    }

    const sentMessage = await targetChannel.send({
      content: messageData.content,
      embeds: messageData.embeds,
      allowedMentions: roleId ? { roles: [roleId] } : undefined,
    });

    if (targetChannel instanceof NewsChannel) {
      try {
        await sentMessage.crosspost();
      } catch (publishError) {
        enhancedLogger.warn(lang.announcement.publish.fail + publishError, LogCategory.COMMAND_EXECUTION);
      }
    }

    const newLog = new AnnouncementLog();
    newLog.guildId = guildId;
    newLog.channelId = targetChannel.id;
    newLog.messageId = sentMessage.id;
    newLog.type = template.name;
    newLog.sentBy = interaction.user.id;
    newLog.scheduledTime = params.time ? new Date(params.time * 1000) : null;
    newLog.version = params.version || null;
    await announcementLogRepo.save(newLog);

    await buttonInteraction.editReply({
      content: `Announcement sent to ${targetChannel}!`,
      embeds: [],
      components: [],
    });

    enhancedLogger.info(
      `User ${interaction.user.username} sent ${template.name} announcement`,
      LogCategory.COMMAND_EXECUTION,
    );
  } catch {
    // Timeout
  }
}
