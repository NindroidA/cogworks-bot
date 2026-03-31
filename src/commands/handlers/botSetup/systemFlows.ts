/**
 * Per-System Configuration Flows
 *
 * Each system has a configuration flow that opens modals or shows selects.
 * On completion, saves data to both the system's config entity AND the SetupState.
 *
 * Auto-create paths fully finalize each system (send embeds, seed data, etc.)
 * to match what the standalone setup commands do.
 *
 * All flows operate in a single ephemeral message (the dashboard). Channel choice
 * uses update() to morph the dashboard in-place, auto-create shows a loading state,
 * and modals use deferUpdate(). The collector in index.ts always refreshes the
 * dashboard after a flow returns, restoring it from any intermediate state.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type Client,
  ComponentType,
  EmbedBuilder,
  type ForumChannel,
  type Guild,
  type GuildForumTagData,
  MessageFlags,
  type StringSelectMenuInteraction,
  type TextChannel,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { type BaitActionType, BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import { MemoryConfig } from '../../../typeorm/entities/memory/MemoryConfig';
import { MemoryTag, type MemoryTagType } from '../../../typeorm/entities/memory/MemoryTag';
import {
  DEFAULT_SYSTEM_STATES,
  type PartialSystemData,
  SetupState,
  type SystemStates,
} from '../../../typeorm/entities/SetupState';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { enhancedLogger, LogCategory, lang, showAndAwaitModal } from '../../../utils';
import { Colors } from '../../../utils/colors';
import { channelSelect, checkbox, labelWrap, radioGroup, rawModal, roleSelect } from '../../../utils/modalComponents';
import { createSystemChannels, type SystemType } from '../../../utils/setup/channelCreator';
import { BAIT_CHANNEL_WARNING, DEFAULT_MEMORY_TAGS } from '../../../utils/setup/channelDefaults';
import { detectGuildChannelFormat } from '../../../utils/setup/channelFormatDetector';
import { seedDefaultTemplates } from '../announcement/templates';
import { buildApplicationMessage } from '../application/applicationPosition';

const VALID_BAIT_ACTIONS: BaitActionType[] = ['ban', 'kick', 'timeout', 'log-only'];

/**
 * Route a system selection to its configuration flow.
 * Returns updated system states after the flow completes.
 */
export async function runSystemFlow(
  systemId: string,
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  client: Client,
  guildId: string,
  setupState: SetupState,
): Promise<{ updated: boolean; states: SystemStates }> {
  const states = { ...(setupState.systemStates || DEFAULT_SYSTEM_STATES) };

  try {
    switch (systemId) {
      case 'staffRole':
        return await configureStaffRole(interaction, guildId, setupState);
      case 'ticket':
        return await configureTicket(interaction, client, guildId, setupState);
      case 'application':
        return await configureApplication(interaction, client, guildId, setupState);
      case 'announcement':
        return await configureAnnouncement(interaction, guildId, setupState);
      case 'baitchannel':
        return await configureBaitChannel(interaction, client, guildId, setupState);
      case 'memory':
        return await configureMemory(interaction, client, guildId, setupState);
      case 'rules':
        return await configureRules(interaction, guildId, setupState);
      case 'reactionRole':
        // Reaction roles are configured via /reactionrole create — show info inline
        await interaction.deferUpdate();
        await interaction.followUp({
          content:
            'Reaction role menus are created with `/reactionrole create`. Use that command to set up your first menu.',
          flags: [MessageFlags.Ephemeral],
        });
        // Don't mark as complete — detectSystemStates checks ReactionRoleMenu count
        return { updated: false, states };
      default:
        return { updated: false, states };
    }
  } catch (error) {
    enhancedLogger.error(`System flow failed: ${systemId}`, error as Error, LogCategory.COMMAND_EXECUTION, { guildId });
    return { updated: false, states };
  }
}

// --- Staff Role ---

async function configureStaffRole(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  guildId: string,
  setupState: SetupState,
) {
  const modal = rawModal(`setup_staff_${Date.now()}`, 'Staff Role Configuration', [
    labelWrap('Staff Role', roleSelect('setup_staff_role'), 'Select the global staff role for all systems'),
    labelWrap('Enable Staff Role', checkbox('setup_staff_enable', true), 'Use a global staff role across systems'),
  ]);

  const submit = await showAndAwaitModal(interaction, modal as any);
  if (!submit) return { updated: false, states: setupState.systemStates };

  const roleId = getModalFieldValue(submit.fields, 'setup_staff_role');
  const enabled = getModalFieldValue(submit.fields, 'setup_staff_enable') ?? true;

  if (roleId && enabled) {
    const repo = AppDataSource.getRepository(BotConfig);
    let config = await repo.findOneBy({ guildId });
    if (!config) config = repo.create({ guildId });
    config.enableGlobalStaffRole = true;
    config.globalStaffRole = roleId;
    await repo.save(config);

    const states = {
      ...setupState.systemStates,
      staffRole: 'complete' as const,
    };
    await saveSetupState(setupState, states, { staffRole: { roleId } });

    await submit.deferUpdate();
    return { updated: true, states };
  }

  await submit.deferUpdate();
  return { updated: false, states: setupState.systemStates };
}

// --- Channel Choice Helper ---

/**
 * Ask user if they want to auto-create channels or select existing ones.
 * Returns the button interaction to chain from (for showModal or deferUpdate).
 * Returns null if cancelled/timed out.
 */
async function askChannelChoice(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  systemLabel: string,
  _systemType: SystemType,
): Promise<{ autoCreate: boolean; btnInteraction: ButtonInteraction } | null> {
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('setup_ch_create')
      .setLabel('Create Channels For Me')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✨'),
    new ButtonBuilder()
      .setCustomId('setup_ch_existing')
      .setLabel('I Have Channels Already')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📁'),
    new ButtonBuilder().setCustomId('setup_ch_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    content: `**${systemLabel} — Channel Setup**\nDo you already have channels for this system, or should I create them for you?`,
    embeds: [],
    components: [buttons],
  });

  const btnResponse = await interaction.channel
    ?.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id && i.customId.startsWith('setup_ch_'),
      componentType: ComponentType.Button,
      time: 60_000,
    })
    .catch(() => null);

  if (!btnResponse || btnResponse.customId === 'setup_ch_cancel') {
    if (btnResponse) await btnResponse.deferUpdate().catch(() => {});
    return null;
  }

  return {
    autoCreate: btnResponse.customId === 'setup_ch_create',
    btnInteraction: btnResponse,
  };
}

// ---------------------------------------------------------------------------
// Shared forum-based system setup (ticket + application share this structure)
// ---------------------------------------------------------------------------

interface ForumSystemData {
  channelId: string;
  archiveId: string;
  categoryId: string;
  messageId?: string;
  archiveMessageId?: string;
}

interface ForumSystemConfig {
  systemKey: SystemType;
  systemLabel: string;
  loadingMessage: string;
  archiveThreadName: string;
  archiveInitialMsg: string;
  modalId: string;
  modalTitle: string;
  channelLabel: string;
  channelFieldId: string;
  archiveFieldId: string;
  categoryLabel: string;
  categoryFieldId: string;
  sendButtonMessage: (guild: Guild, channelId: string, guildId: string) => Promise<string | undefined>;
  saveConfig: (guildId: string, data: ForumSystemData) => Promise<void>;
}

async function configureForumSystem(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  guildId: string,
  setupState: SetupState,
  cfg: ForumSystemConfig,
) {
  const partial = (setupState.partialData as Record<string, any>)?.[cfg.systemKey];

  const choice = await askChannelChoice(interaction, cfg.systemLabel, cfg.systemKey);
  if (!choice) return { updated: false, states: setupState.systemStates };

  if (choice.autoCreate) {
    await choice.btnInteraction.update({
      content: `⏳ ${cfg.loadingMessage}`,
      embeds: [],
      components: [],
    });
    const guild = interaction.guild!;
    const format = detectGuildChannelFormat(guild);
    const created = await createSystemChannels(guild, cfg.systemKey, format);

    const data: ForumSystemData = {
      channelId: created.button!,
      archiveId: created.archive!,
      categoryId: created.threadCategory || created.category!,
    };

    if (data.channelId && data.archiveId && data.categoryId) {
      data.messageId = await cfg.sendButtonMessage(guild, data.channelId, guildId);

      try {
        const archiveForum = (await guild.channels.fetch(data.archiveId)) as ForumChannel;
        const thread = await archiveForum.threads.create({
          name: cfg.archiveThreadName,
          message: { content: cfg.archiveInitialMsg },
        });
        try {
          await thread.pin();
        } catch {}
        data.archiveMessageId = thread.id;
      } catch (_error) {
        enhancedLogger.warn(
          `Failed to create archive welcome thread during auto-setup (${cfg.systemKey})`,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
      }

      await cfg.saveConfig(guildId, data);
      const states = {
        ...setupState.systemStates,
        [cfg.systemKey]: 'complete' as const,
      };
      await saveSetupState(setupState, states, { [cfg.systemKey]: data });
      return { updated: true, states };
    }

    return { updated: false, states: setupState.systemStates };
  }

  // Manual channel selection via modal
  const modal = rawModal(`${cfg.modalId}_${Date.now()}`, cfg.modalTitle, [
    labelWrap(
      cfg.channelLabel,
      channelSelect(cfg.channelFieldId, [ChannelType.GuildText]),
      `Channel for the ${cfg.systemKey} button`,
    ),
    labelWrap(
      'Archive Forum',
      channelSelect(cfg.archiveFieldId, [ChannelType.GuildForum]),
      `Forum for closed ${cfg.systemKey} archives`,
    ),
    labelWrap(
      cfg.categoryLabel,
      channelSelect(cfg.categoryFieldId, [ChannelType.GuildCategory]),
      `Category where ${cfg.systemKey} threads are created`,
    ),
  ]);

  const submit = await showAndAwaitModal(choice.btnInteraction, modal as any);
  if (!submit) return { updated: false, states: setupState.systemStates };

  const channelId = getModalFieldValue(submit.fields, cfg.channelFieldId) || partial?.channelId;
  const archiveId = getModalFieldValue(submit.fields, cfg.archiveFieldId) || partial?.archiveId;
  const categoryId = getModalFieldValue(submit.fields, cfg.categoryFieldId) || partial?.categoryId;

  const data: Partial<ForumSystemData> = { channelId, archiveId, categoryId };

  if (data.channelId && data.archiveId && data.categoryId) {
    const guild = submit.guild!;

    data.messageId = await cfg.sendButtonMessage(guild, data.channelId, guildId);

    try {
      const archiveForum = (await guild.channels.fetch(data.archiveId)) as ForumChannel;
      const thread = await archiveForum.threads.create({
        name: cfg.archiveThreadName,
        message: { content: cfg.archiveInitialMsg },
      });
      try {
        await thread.pin();
      } catch {}
      data.archiveMessageId = thread.id;
    } catch {
      enhancedLogger.warn(
        `Failed to create archive welcome thread during existing-channel setup (${cfg.systemKey})`,
        LogCategory.COMMAND_EXECUTION,
        { guildId },
      );
    }

    await cfg.saveConfig(guildId, data as ForumSystemData);
    const states = {
      ...setupState.systemStates,
      [cfg.systemKey]: 'complete' as const,
    };
    await saveSetupState(setupState, states, { [cfg.systemKey]: data });
    await submit.deferUpdate();
    return { updated: true, states };
  }

  const states = {
    ...setupState.systemStates,
    [cfg.systemKey]: 'partial' as const,
  };
  await saveSetupState(setupState, states, { [cfg.systemKey]: data });
  await submit.deferUpdate();
  return { updated: true, states };
}

// ---------------------------------------------------------------------------
// Per-system save helpers
// ---------------------------------------------------------------------------

async function saveTicketConfig(guildId: string, data: ForumSystemData) {
  const ticketRepo = AppDataSource.getRepository(TicketConfig);
  let config = await ticketRepo.findOneBy({ guildId });
  if (!config) config = ticketRepo.create({ guildId, messageId: '' });
  config.channelId = data.channelId;
  config.categoryId = data.categoryId;
  if (data.messageId) config.messageId = data.messageId;
  await ticketRepo.save(config);

  const archiveRepo = AppDataSource.getRepository(ArchivedTicketConfig);
  let archive = await archiveRepo.findOneBy({ guildId });
  if (!archive) archive = archiveRepo.create({ guildId, messageId: '' });
  archive.channelId = data.archiveId;
  if (data.archiveMessageId) archive.messageId = data.archiveMessageId;
  await archiveRepo.save(archive);
}

async function saveApplicationConfig(guildId: string, data: ForumSystemData) {
  const appRepo = AppDataSource.getRepository(ApplicationConfig);
  let config = await appRepo.findOneBy({ guildId });
  if (!config) config = appRepo.create({ guildId, messageId: '' });
  config.channelId = data.channelId;
  config.categoryId = data.categoryId;
  if (data.messageId) config.messageId = data.messageId;
  await appRepo.save(config);

  const archiveRepo = AppDataSource.getRepository(ArchivedApplicationConfig);
  let archive = await archiveRepo.findOneBy({ guildId });
  if (!archive) archive = archiveRepo.create({ guildId, messageId: '' });
  archive.channelId = data.archiveId;
  if (data.archiveMessageId) archive.messageId = data.archiveMessageId;
  await archiveRepo.save(archive);
}

// ---------------------------------------------------------------------------
// Per-system button message senders
// ---------------------------------------------------------------------------

async function sendTicketButton(guild: Guild, channelId: string, _guildId: string): Promise<string | undefined> {
  try {
    const buttonChannel = (await guild.channels.fetch(channelId)) as TextChannel;
    const ticketButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket')
        .setEmoji('🎫')
        .setLabel(lang.general.buttons.createTicket)
        .setStyle(ButtonStyle.Primary),
    );
    const msg = await buttonChannel.send({
      content: lang.ticketSetup.createTicket,
      components: [ticketButton],
    });
    return msg.id;
  } catch (_error) {
    enhancedLogger.warn('Failed to send ticket button message', LogCategory.COMMAND_EXECUTION, { guildId: guild.id });
    return undefined;
  }
}

async function sendApplicationButton(guild: Guild, channelId: string, guildId: string): Promise<string | undefined> {
  try {
    const buttonChannel = (await guild.channels.fetch(channelId)) as TextChannel;
    const positionRepo = AppDataSource.getRepository(Position);
    const activePositions = await positionRepo.find({
      where: { guildId, isActive: true },
      order: { displayOrder: 'ASC' },
    });
    const { content, components } = await buildApplicationMessage(activePositions);
    const msg = await buttonChannel.send({ content, components });
    return msg.id;
  } catch (_error) {
    enhancedLogger.warn('Failed to send application button message', LogCategory.COMMAND_EXECUTION, { guildId });
    return undefined;
  }
}

// --- Ticket System ---

async function configureTicket(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  _client: Client,
  guildId: string,
  setupState: SetupState,
) {
  return configureForumSystem(interaction, guildId, setupState, {
    systemKey: 'ticket',
    systemLabel: 'Ticket System',
    loadingMessage: 'Creating ticket channels...',
    archiveThreadName: 'Ticket Archive',
    archiveInitialMsg: lang.ticketSetup.archiveInitialMsg,
    modalId: 'setup_ticket',
    modalTitle: 'Ticket System Setup',
    channelLabel: 'Ticket Channel',
    channelFieldId: 'setup_ticket_ch',
    archiveFieldId: 'setup_ticket_archive',
    categoryLabel: 'Ticket Category',
    categoryFieldId: 'setup_ticket_cat',
    sendButtonMessage: sendTicketButton,
    saveConfig: saveTicketConfig,
  });
}

// --- Application System ---

async function configureApplication(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  _client: Client,
  guildId: string,
  setupState: SetupState,
) {
  return configureForumSystem(interaction, guildId, setupState, {
    systemKey: 'application',
    systemLabel: 'Application System',
    loadingMessage: 'Creating application channels...',
    archiveThreadName: 'Application Archive',
    archiveInitialMsg: lang.application.setup.archiveInitialMsg,
    modalId: 'setup_app',
    modalTitle: 'Application System Setup',
    channelLabel: 'Application Channel',
    channelFieldId: 'setup_app_ch',
    archiveFieldId: 'setup_app_archive',
    categoryLabel: 'Application Category',
    categoryFieldId: 'setup_app_cat',
    sendButtonMessage: sendApplicationButton,
    saveConfig: saveApplicationConfig,
  });
}

// --- Announcements ---

async function configureAnnouncement(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  guildId: string,
  setupState: SetupState,
) {
  // Step 1: Ask create or select existing
  const choice = await askChannelChoice(interaction, 'Announcement System', 'announcement');
  if (!choice) return { updated: false, states: setupState.systemStates };

  if (choice.autoCreate) {
    // Auto-create announcement channel, use @everyone as default role
    await choice.btnInteraction.update({
      content: '⏳ Creating announcement channel...',
      embeds: [],
      components: [],
    });
    const guild = interaction.guild!;
    const format = detectGuildChannelFormat(guild);
    const created = await createSystemChannels(guild, 'announcement', format);

    const channelId = created.channel;
    if (channelId) {
      const roleId = guild.id; // @everyone role ID === guild ID
      const repo = AppDataSource.getRepository(AnnouncementConfig);
      let config = await repo.findOneBy({ guildId });
      if (!config) config = repo.create({ guildId });
      config.defaultRoleId = roleId;
      config.defaultChannelId = channelId;
      await repo.save(config);

      await seedDefaultTemplates(guildId);

      const states = {
        ...setupState.systemStates,
        announcement: 'complete' as const,
      };
      await saveSetupState(setupState, states, {
        announcement: { roleId, channelId },
      });
      return { updated: true, states };
    }

    return { updated: false, states: setupState.systemStates };
  }

  // Step 2: Show modal for channel + role selection
  const modal = rawModal(`setup_ann_${Date.now()}`, 'Announcement Setup', [
    labelWrap('Announcement Role', roleSelect('setup_ann_role'), 'Role to ping for announcements'),
    labelWrap(
      'Default Channel',
      channelSelect('setup_ann_ch', [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
      'Default channel for announcements',
    ),
  ]);

  const submit = await showAndAwaitModal(choice.btnInteraction, modal as any);
  if (!submit) return { updated: false, states: setupState.systemStates };

  const roleId = getModalFieldValue(submit.fields, 'setup_ann_role');
  const channelId = getModalFieldValue(submit.fields, 'setup_ann_ch');

  if (roleId && channelId) {
    const repo = AppDataSource.getRepository(AnnouncementConfig);
    let config = await repo.findOneBy({ guildId });
    if (!config) config = repo.create({ guildId });
    config.defaultRoleId = roleId;
    config.defaultChannelId = channelId;
    await repo.save(config);

    await seedDefaultTemplates(guildId);

    const states = {
      ...setupState.systemStates,
      announcement: 'complete' as const,
    };
    await saveSetupState(setupState, states, {
      announcement: { roleId, channelId },
    });
    await submit.deferUpdate();
    return { updated: true, states };
  }

  const states = {
    ...setupState.systemStates,
    announcement: 'partial' as const,
  };
  await saveSetupState(setupState, states, {
    announcement: { roleId, channelId },
  });
  await submit.deferUpdate();
  return { updated: true, states };
}

// --- Bait Channel ---

async function configureBaitChannel(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  client: Client,
  guildId: string,
  setupState: SetupState,
) {
  // Step 1: Ask create or select existing
  const choice = await askChannelChoice(interaction, 'Bait Channel System', 'bait');
  if (!choice) return { updated: false, states: setupState.systemStates };

  if (choice.autoCreate) {
    // Auto-create bait + log channels with safe defaults (log-only + test mode)
    await choice.btnInteraction.update({
      content: '⏳ Creating bait channels...',
      embeds: [],
      components: [],
    });
    const guild = interaction.guild!;
    const format = detectGuildChannelFormat(guild);
    const created = await createSystemChannels(guild, 'bait', format);

    const channelId = created.channel;
    const logChannelId = created.log;

    if (channelId) {
      const actionType: BaitActionType = 'log-only';
      const repo = AppDataSource.getRepository(BaitChannelConfig);
      let config = await repo.findOneBy({ guildId });
      if (!config) config = repo.create({ guildId, channelId });
      config.channelId = channelId;
      config.channelIds = [channelId];
      config.actionType = actionType;
      config.testMode = true;
      if (logChannelId) config.logChannelId = logChannelId;

      // Send warning message in the bait channel
      try {
        const baitChannel = (await guild.channels.fetch(channelId)) as TextChannel;
        const msg = await baitChannel.send({ content: BAIT_CHANNEL_WARNING });
        config.channelMessageId = msg.id;
      } catch {
        enhancedLogger.warn(
          'Failed to send warning message to bait channel during auto-setup',
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
      }

      await repo.save(config);

      // Seed default keywords
      try {
        const { seedDefaultKeywords } = await import('../baitChannel/keywords');
        await seedDefaultKeywords(guildId);
      } catch {
        enhancedLogger.warn(
          'Failed to seed default keywords during bait channel auto-setup',
          LogCategory.COMMAND_EXECUTION,
        );
      }

      (client as ExtendedClient).baitChannelManager?.clearConfigCache(guildId);

      const states = {
        ...setupState.systemStates,
        baitchannel: 'complete' as const,
      };
      await saveSetupState(setupState, states, {
        baitchannel: { channelId, actionType, logChannelId },
      });
      return { updated: true, states };
    }

    return { updated: false, states: setupState.systemStates };
  }

  // Step 2: Show modal with full config (channels + action type)
  const modal = rawModal(`setup_bait_${Date.now()}`, 'Bait Channel Setup', [
    labelWrap('Bait Channel', channelSelect('setup_bait_ch', [ChannelType.GuildText]), 'Channel for bot detection'),
    labelWrap(
      'Action Type',
      radioGroup('setup_bait_action', [
        {
          label: 'Ban',
          value: 'ban',
          description: 'Permanently ban the user',
          default: true,
        },
        { label: 'Kick', value: 'kick', description: 'Kick the user' },
        {
          label: 'Timeout',
          value: 'timeout',
          description: 'Timeout the user',
        },
        {
          label: 'Log Only',
          value: 'log-only',
          description: 'Just log, no action',
        },
      ]),
      'What happens when someone posts',
    ),
    labelWrap(
      'Log Channel',
      channelSelect('setup_bait_log', [ChannelType.GuildText], false),
      'Optional channel for detection logs',
    ),
  ]);

  const submit = await showAndAwaitModal(choice.btnInteraction, modal as any);
  if (!submit) return { updated: false, states: setupState.systemStates };

  const channelId = getModalFieldValue(submit.fields, 'setup_bait_ch');
  const rawAction = getModalFieldValue(submit.fields, 'setup_bait_action') || 'ban';
  const actionType = VALID_BAIT_ACTIONS.includes(rawAction as BaitActionType) ? (rawAction as BaitActionType) : 'ban';
  const logChannelId = getModalFieldValue(submit.fields, 'setup_bait_log') || undefined;

  if (channelId) {
    const repo = AppDataSource.getRepository(BaitChannelConfig);
    let config = await repo.findOneBy({ guildId });
    if (!config) config = repo.create({ guildId, channelId });
    config.channelId = channelId;
    config.channelIds = [channelId];
    config.actionType = actionType;
    if (logChannelId) config.logChannelId = logChannelId;

    // Send warning message in the bait channel (matches auto-create path)
    try {
      const guild = submit.guild!;
      const baitChannel = (await guild.channels.fetch(channelId)) as TextChannel;
      const msg = await baitChannel.send({ content: BAIT_CHANNEL_WARNING });
      config.channelMessageId = msg.id;
    } catch {
      enhancedLogger.warn(
        'Failed to send warning message to bait channel during existing-channel setup',
        LogCategory.COMMAND_EXECUTION,
        { guildId },
      );
    }

    await repo.save(config);

    // Seed default keywords (matches auto-create path)
    try {
      const { seedDefaultKeywords } = await import('../baitChannel/keywords');
      await seedDefaultKeywords(guildId);
    } catch {
      enhancedLogger.warn(
        'Failed to seed default keywords during bait channel existing-channel setup',
        LogCategory.COMMAND_EXECUTION,
      );
    }

    (client as ExtendedClient).baitChannelManager?.clearConfigCache(guildId);

    const states = {
      ...setupState.systemStates,
      baitchannel: 'complete' as const,
    };
    await saveSetupState(setupState, states, {
      baitchannel: { channelId, actionType, logChannelId },
    });
    await submit.deferUpdate();
    return { updated: true, states };
  }

  await submit.deferUpdate();
  return { updated: false, states: setupState.systemStates };
}

// --- Memory System ---

async function configureMemory(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  _client: Client,
  guildId: string,
  setupState: SetupState,
) {
  // Step 1: Ask create or select existing
  const choice = await askChannelChoice(interaction, 'Memory System', 'memory');
  if (!choice) return { updated: false, states: setupState.systemStates };

  if (choice.autoCreate) {
    // Auto-create forum channel
    await choice.btnInteraction.update({
      content: '⏳ Creating memory forum channel...',
      embeds: [],
      components: [],
    });
    const guild = interaction.guild!;
    const format = detectGuildChannelFormat(guild);
    const created = await createSystemChannels(guild, 'memory', format);

    const forumChannelId = created.forum;
    if (forumChannelId) {
      const repo = AppDataSource.getRepository(MemoryConfig);
      let config = await repo.findOneBy({ guildId });
      if (!config)
        config = repo.create({
          guildId,
          forumChannelId,
          channelName: 'memory',
        });
      else config.forumChannelId = forumChannelId;
      await repo.save(config);

      // Seed default forum tags + create welcome thread
      try {
        const forum = (await guild.channels.fetch(forumChannelId)) as ForumChannel;
        await createDefaultMemoryTags(guildId, config.id, forum);

        // Post welcome thread (matches memorySetup.ts postWelcomeThread)
        const welcomeThread = await createMemoryWelcomeThread(forum);
        if (welcomeThread) {
          config.messageId = welcomeThread;
          await repo.save(config);
        }
      } catch (_error) {
        enhancedLogger.warn('Failed to seed default memory tags during auto-setup', LogCategory.COMMAND_EXECUTION, {
          guildId,
        });
      }

      const states = {
        ...setupState.systemStates,
        memory: 'complete' as const,
      };
      await saveSetupState(setupState, states, {
        memory: { forumChannelId },
      });
      return { updated: true, states };
    }

    return { updated: false, states: setupState.systemStates };
  }

  // Step 2: Show modal for existing channel selection
  const modal = rawModal(`setup_memory_${Date.now()}`, 'Memory System Setup', [
    labelWrap(
      'Memory Forum Channel',
      channelSelect('setup_memory_forum', [ChannelType.GuildForum]),
      'Forum channel for memory items',
    ),
  ]);

  const submit = await showAndAwaitModal(choice.btnInteraction, modal as any);
  if (!submit) return { updated: false, states: setupState.systemStates };

  const forumChannelId = getModalFieldValue(submit.fields, 'setup_memory_forum');

  if (forumChannelId) {
    const repo = AppDataSource.getRepository(MemoryConfig);
    let config = await repo.findOneBy({ guildId });
    if (!config) config = repo.create({ guildId, forumChannelId, channelName: 'memory' });
    else config.forumChannelId = forumChannelId;
    await repo.save(config);

    // Seed default forum tags + create welcome thread (matches auto-create path)
    try {
      const guild = submit.guild!;
      const forum = (await guild.channels.fetch(forumChannelId)) as ForumChannel;
      await createDefaultMemoryTags(guildId, config.id, forum);

      // Post welcome thread (matches memorySetup.ts postWelcomeThread)
      const welcomeThread = await createMemoryWelcomeThread(forum);
      if (welcomeThread) {
        config.messageId = welcomeThread;
        await repo.save(config);
      }
    } catch (_error) {
      enhancedLogger.warn(
        'Failed to seed default memory tags during existing-channel setup',
        LogCategory.COMMAND_EXECUTION,
        { guildId },
      );
    }

    const states = { ...setupState.systemStates, memory: 'complete' as const };
    await saveSetupState(setupState, states, { memory: { forumChannelId } });
    await submit.deferUpdate();
    return { updated: true, states };
  }

  await submit.deferUpdate();
  return { updated: false, states: setupState.systemStates };
}

/**
 * Create default forum tags for a memory channel.
 * Matches the logic in memorySetup.ts createDefaultTags().
 */
async function createDefaultMemoryTags(guildId: string, configId: number, forum: ForumChannel) {
  const allTags: GuildForumTagData[] = [];
  const dbTags: Partial<MemoryTag>[] = [];

  for (const tag of DEFAULT_MEMORY_TAGS.category) {
    allTags.push({ name: tag.name, emoji: { id: null, name: tag.emoji } });
    dbTags.push({
      guildId,
      memoryConfigId: configId,
      name: tag.name,
      emoji: tag.emoji,
      tagType: 'category' as MemoryTagType,
      isDefault: true,
    });
  }

  for (const tag of DEFAULT_MEMORY_TAGS.status) {
    allTags.push({ name: tag.name, emoji: { id: null, name: tag.emoji } });
    dbTags.push({
      guildId,
      memoryConfigId: configId,
      name: tag.name,
      emoji: tag.emoji,
      tagType: 'status' as MemoryTagType,
      isDefault: true,
    });
  }

  const updatedForum = await forum.setAvailableTags(allTags);

  for (const dbTag of dbTags) {
    const discordTag = updatedForum.availableTags.find(t => t.name === dbTag.name);
    if (discordTag) {
      dbTag.discordTagId = discordTag.id;
    }
  }

  const memoryTagRepo = AppDataSource.getRepository(MemoryTag);
  await memoryTagRepo.save(dbTags as MemoryTag[]);
}

// --- Rules Acknowledgment ---

async function configureRules(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  _guildId: string,
  setupState: SetupState,
) {
  // Step 1: Ask create or select existing
  const choice = await askChannelChoice(interaction, 'Rules System', 'rules');
  if (!choice) return { updated: false, states: setupState.systemStates };

  if (choice.autoCreate) {
    // Auto-create rules channel, default to ✅ emoji — user still needs /rules-setup for message + role
    await choice.btnInteraction.update({
      content: '⏳ Creating rules channel...',
      embeds: [],
      components: [],
    });
    const guild = interaction.guild!;
    const format = detectGuildChannelFormat(guild);
    const created = await createSystemChannels(guild, 'rules', format);

    const channelId = created.channel;
    if (channelId) {
      const states = {
        ...setupState.systemStates,
        rules: 'partial' as const,
      };
      await saveSetupState(setupState, states, {
        rules: { channelId, emoji: '✅' },
      });
      return { updated: true, states };
    }

    return { updated: false, states: setupState.systemStates };
  }

  // Step 2: Show modal for existing channel + role selection
  const modal = rawModal(`setup_rules_${Date.now()}`, 'Rules Setup', [
    labelWrap(
      'Rules Channel',
      channelSelect('setup_rules_ch', [ChannelType.GuildText]),
      'Channel for the rules message',
    ),
    labelWrap('Verified Role', roleSelect('setup_rules_role'), 'Role to give when user accepts rules'),
  ]);

  const submit = await showAndAwaitModal(choice.btnInteraction, modal as any);
  if (!submit) return { updated: false, states: setupState.systemStates };

  const channelId = getModalFieldValue(submit.fields, 'setup_rules_ch');
  const roleId = getModalFieldValue(submit.fields, 'setup_rules_role');

  if (channelId && roleId) {
    const states = { ...setupState.systemStates, rules: 'partial' as const };
    await saveSetupState(setupState, states, {
      rules: { channelId, roleId, emoji: '✅' },
    });
    await submit.deferUpdate();
    return { updated: true, states };
  }

  await submit.deferUpdate();
  return { updated: false, states: setupState.systemStates };
}

// --- Memory Welcome Thread ---

/**
 * Create a pinned welcome thread in a memory forum channel.
 * Matches the logic in memorySetup.ts postWelcomeThread().
 */
async function createMemoryWelcomeThread(forum: ForumChannel): Promise<string | null> {
  try {
    const embed = new EmbedBuilder()
      .setTitle(lang.memory.setup.welcomeTitle)
      .setDescription(lang.memory.setup.welcomeDescription)
      .setColor(Colors.brand.primary);

    const thread = await forum.threads.create({
      name: lang.memory.setup.welcomeTitle,
      message: { embeds: [embed] },
    });

    try {
      await thread.pin();
    } catch {}

    return thread.id;
  } catch {
    enhancedLogger.warn('Failed to create memory welcome thread', LogCategory.COMMAND_EXECUTION);
    return null;
  }
}

// --- Field Value Extraction ---

/**
 * Extract a field value from a modal submit.
 * Handles both old TextInput (.value) and new Components v2 (.value or .values[0]).
 */
function getModalFieldValue(fields: any, customId: string): string | undefined {
  try {
    const field = fields.getField(customId);
    if (!field) return undefined;
    // TextInput, RadioGroup, Checkbox return .value
    if (field.value !== undefined && field.value !== null) return String(field.value);
    // ChannelSelect, RoleSelect may return .values array
    if (Array.isArray(field.values) && field.values.length > 0) return field.values[0];
    return undefined;
  } catch {
    return undefined;
  }
}

// --- Helpers ---

async function saveSetupState(
  setupState: SetupState,
  states: SystemStates,
  newPartialData: PartialSystemData,
): Promise<void> {
  const repo = AppDataSource.getRepository(SetupState);
  setupState.systemStates = states;
  setupState.partialData = { ...setupState.partialData, ...newPartialData };
  await repo.save(setupState);
}
