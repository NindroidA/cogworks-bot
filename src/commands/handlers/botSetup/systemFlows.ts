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
 *
 * Forum-based systems (ticket, application) use `configureForumSystem` + a
 * `ForumSystemConfig`. Single-channel systems (announcement, baitchannel,
 * memory, rules) use `runSimpleSystemFlow` + a `SimpleSystemConfig` descriptor
 * picked from `SIMPLE_SYSTEM_CONFIGS`.
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
  type ModalSubmitInteraction,
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
import {
  enhancedLogger,
  extractModalBoolean,
  extractModalField,
  LogCategory,
  lang,
  showAndAwaitModal,
  TIMEOUTS,
} from '../../../utils';
import { Colors } from '../../../utils/colors';
import { upsertGuildEntity } from '../../../utils/database/guildQueries';
import { channelSelect, checkbox, labelWrap, radioGroup, rawModal, roleSelect } from '../../../utils/modalComponents';
import { type CreatedChannels, createSystemChannels, type SystemType } from '../../../utils/setup/channelCreator';
import { BAIT_CHANNEL_WARNING, DEFAULT_MEMORY_TAGS } from '../../../utils/setup/channelDefaults';
import { detectGuildChannelFormat } from '../../../utils/setup/channelFormatDetector';
import { requestGuildCommandRefresh } from '../../../utils/setup/commandGating';
import { seedDefaultTemplates } from '../announcement/templates';
import { buildApplicationMessage } from '../application/applicationPosition';

const VALID_BAIT_ACTIONS: BaitActionType[] = ['ban', 'kick', 'timeout', 'log-only'];

/** Best-effort thread pin — logs instead of silently swallowing (max pins / missing perms). */
async function pinThreadBestEffort(thread: { pin: () => Promise<unknown> }): Promise<void> {
  try {
    await thread.pin();
  } catch {
    enhancedLogger.info('Could not pin setup welcome thread (max pins may be reached)', LogCategory.SYSTEM);
  }
}

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
): Promise<{ updated: boolean; states: SystemStates; failed?: boolean }> {
  const states = { ...(setupState.systemStates || DEFAULT_SYSTEM_STATES) };

  try {
    // Simple systems (announcement, baitchannel, memory, rules) share a common
    // flow shape — descriptor table dispatch.
    const simpleConfig = SIMPLE_SYSTEM_CONFIGS[systemId as SimpleSystemKey];
    if (simpleConfig) {
      return await runSimpleSystemFlow(simpleConfig, interaction, client, guildId, setupState);
    }

    switch (systemId) {
      case 'staffRole':
        return await configureStaffRole(interaction, guildId, setupState);
      case 'ticket':
        return await configureTicket(interaction, client, guildId, setupState);
      case 'application':
        return await configureApplication(interaction, client, guildId, setupState);
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
    // failed:true lets the dashboard tell the user instead of silently
    // redrawing as if nothing happened (e.g. Missing Permissions mid-flow).
    return { updated: false, states, failed: true };
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

  const submit = await showAndAwaitModal(interaction, modal);
  if (!submit)
    return {
      updated: false,
      states: setupState.systemStates ?? DEFAULT_SYSTEM_STATES,
    };

  const roleId = extractModalField(submit.fields, 'setup_staff_role');
  // Checkbox → boolean. extractModalField would stringify, making an unchecked
  // box the truthy "false" and ignoring the user disabling the staff role.
  const enabled = extractModalBoolean(submit.fields, 'setup_staff_enable', true);

  if (roleId && enabled) {
    await upsertGuildEntity(AppDataSource.getRepository(BotConfig), guildId, {
      apply: config => {
        config.enableGlobalStaffRole = true;
        config.globalStaffRole = roleId;
      },
    });

    const states = {
      ...(setupState.systemStates ?? DEFAULT_SYSTEM_STATES),
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
      time: TIMEOUTS.COMPONENT,
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
  // Dynamic keyed lookup — each subtree has a different shape so we read the
  // optional string fields generically rather than narrowing per system.
  const partial = setupState.partialData?.[cfg.systemKey as keyof typeof setupState.partialData] as
    | Record<string, string | undefined>
    | undefined;

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
        await pinThreadBestEffort(thread);
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
        ...(setupState.systemStates ?? DEFAULT_SYSTEM_STATES),
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

  const submit = await showAndAwaitModal(choice.btnInteraction, modal);
  if (!submit)
    return {
      updated: false,
      states: setupState.systemStates ?? DEFAULT_SYSTEM_STATES,
    };

  const channelId = extractModalField(submit.fields, cfg.channelFieldId) || partial?.channelId;
  const archiveId = extractModalField(submit.fields, cfg.archiveFieldId) || partial?.archiveId;
  const categoryId = extractModalField(submit.fields, cfg.categoryFieldId) || partial?.categoryId;

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
      await pinThreadBestEffort(thread);
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
      ...(setupState.systemStates ?? DEFAULT_SYSTEM_STATES),
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
  await upsertGuildEntity(AppDataSource.getRepository(TicketConfig), guildId, {
    create: { messageId: '' },
    apply: config => {
      config.channelId = data.channelId;
      config.categoryId = data.categoryId;
      if (data.messageId) config.messageId = data.messageId;
    },
  });

  await upsertGuildEntity(AppDataSource.getRepository(ArchivedTicketConfig), guildId, {
    create: { messageId: '' },
    apply: archive => {
      archive.channelId = data.archiveId;
      if (data.archiveMessageId) archive.messageId = data.archiveMessageId;
    },
  });
}

async function saveApplicationConfig(guildId: string, data: ForumSystemData) {
  await upsertGuildEntity(AppDataSource.getRepository(ApplicationConfig), guildId, {
    create: { messageId: '' },
    apply: config => {
      config.channelId = data.channelId;
      config.categoryId = data.categoryId;
      if (data.messageId) config.messageId = data.messageId;
    },
  });

  await upsertGuildEntity(AppDataSource.getRepository(ArchivedApplicationConfig), guildId, {
    create: { messageId: '' },
    apply: archive => {
      archive.channelId = data.archiveId;
      if (data.archiveMessageId) archive.messageId = data.archiveMessageId;
    },
  });
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

// ---------------------------------------------------------------------------
// Simple single-channel systems (announcement, baitchannel, memory, rules)
// ---------------------------------------------------------------------------

type SimpleSystemKey = 'announcement' | 'baitchannel' | 'memory' | 'rules';

type SimplePartialData<K extends SimpleSystemKey> = NonNullable<PartialSystemData[K]>;

type ModalParseResult<TData, K extends SimpleSystemKey> =
  | { kind: 'complete'; data: TData }
  | { kind: 'partial'; data: SimplePartialData<K> }
  | { kind: 'insufficient' };

interface SimpleSystemConfig<TData, K extends SimpleSystemKey = SimpleSystemKey> {
  /** SetupState key — also keys `partialData` and `systemStates`. */
  systemKey: K;
  /** `channelDefaults` key for `createSystemChannels` (e.g. `'bait'` for `baitchannel`). */
  channelType: SystemType;
  /** Display label for `askChannelChoice` (e.g. "Announcement System"). */
  systemLabel: string;
  /** Loading text shown after the auto-create button is clicked. */
  loadingMessage: string;
  /** Build TData from `createSystemChannels` result, or null if creation failed. */
  fromAutoCreate: (created: CreatedChannels, guild: Guild) => TData | null;
  /** Build the manual-path modal. */
  buildModal: () => ReturnType<typeof rawModal>;
  /**
   * Parse modal submit into a complete/partial/insufficient outcome.
   * - `complete`: full config — `apply()` runs, state set to `finalState`
   * - `partial`: incomplete or two-stage — partial data saved, state set to 'partial' (apply skipped)
   * - `insufficient`: not enough to even partially save — just `deferUpdate()`
   */
  fromModal: (submit: ModalSubmitInteraction) => ModalParseResult<TData, K>;
  /** Save config + run side effects (sends, seeds, cache invalidations). */
  apply: (guildId: string, data: TData, ctx: { guild: Guild; client: Client }) => Promise<void>;
  /** Convert TData to the `partialData` persistence shape for SetupState. */
  toPartialData: (data: TData) => SimplePartialData<K>;
  /** State to set after a successful apply. Defaults to 'complete'. Rules uses 'partial' (two-stage). */
  finalState?: 'complete' | 'partial';
}

async function runSimpleSystemFlow<TData, K extends SimpleSystemKey>(
  cfg: SimpleSystemConfig<TData, K>,
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  client: Client,
  guildId: string,
  setupState: SetupState,
): Promise<{ updated: boolean; states: SystemStates }> {
  const choice = await askChannelChoice(interaction, cfg.systemLabel, cfg.channelType);
  if (!choice) return { updated: false, states: setupState.systemStates };

  const completeState = cfg.finalState ?? 'complete';

  if (choice.autoCreate) {
    await choice.btnInteraction.update({
      content: `⏳ ${cfg.loadingMessage}`,
      embeds: [],
      components: [],
    });
    const guild = interaction.guild!;
    const format = detectGuildChannelFormat(guild);
    const created = await createSystemChannels(guild, cfg.channelType, format);

    const data = cfg.fromAutoCreate(created, guild);
    if (!data) return { updated: false, states: setupState.systemStates };

    await cfg.apply(guildId, data, { guild, client });

    const states = {
      ...(setupState.systemStates ?? DEFAULT_SYSTEM_STATES),
      [cfg.systemKey]: completeState,
    };
    await saveSetupState(setupState, states, {
      [cfg.systemKey]: cfg.toPartialData(data),
    });
    return { updated: true, states };
  }

  // Manual path
  const submit = await showAndAwaitModal(choice.btnInteraction, cfg.buildModal());
  if (!submit)
    return {
      updated: false,
      states: setupState.systemStates ?? DEFAULT_SYSTEM_STATES,
    };

  const guild = submit.guild!;
  const result = cfg.fromModal(submit);

  if (result.kind === 'insufficient') {
    await submit.deferUpdate();
    return {
      updated: false,
      states: setupState.systemStates ?? DEFAULT_SYSTEM_STATES,
    };
  }

  if (result.kind === 'complete') {
    await cfg.apply(guildId, result.data, { guild, client });
    const states = {
      ...(setupState.systemStates ?? DEFAULT_SYSTEM_STATES),
      [cfg.systemKey]: completeState,
    };
    await saveSetupState(setupState, states, {
      [cfg.systemKey]: cfg.toPartialData(result.data),
    });
    await submit.deferUpdate();
    return { updated: true, states };
  }

  // kind === 'partial'
  const states = {
    ...(setupState.systemStates ?? DEFAULT_SYSTEM_STATES),
    [cfg.systemKey]: 'partial' as const,
  };
  await saveSetupState(setupState, states, { [cfg.systemKey]: result.data });
  await submit.deferUpdate();
  return { updated: true, states };
}

// --- Announcement ---

interface AnnouncementData {
  roleId: string;
  channelId: string;
}

const announcementConfig: SimpleSystemConfig<AnnouncementData, 'announcement'> = {
  systemKey: 'announcement',
  channelType: 'announcement',
  systemLabel: 'Announcement System',
  loadingMessage: 'Creating announcement channel...',
  fromAutoCreate: (created, guild) => {
    if (!created.channel) return null;
    // @everyone role ID === guild ID
    return { roleId: guild.id, channelId: created.channel };
  },
  buildModal: () =>
    rawModal(`setup_ann_${Date.now()}`, 'Announcement Setup', [
      labelWrap('Announcement Role', roleSelect('setup_ann_role'), 'Role to ping for announcements'),
      labelWrap(
        'Default Channel',
        channelSelect('setup_ann_ch', [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
        'Default channel for announcements',
      ),
    ]),
  fromModal: submit => {
    const roleId = extractModalField(submit.fields, 'setup_ann_role');
    const channelId = extractModalField(submit.fields, 'setup_ann_ch');
    if (roleId && channelId) return { kind: 'complete', data: { roleId, channelId } };
    // Preserves prior behavior: always saves a partial entry on the manual path,
    // even if both fields are absent (resume-later state remains visible).
    return { kind: 'partial', data: { roleId, channelId } };
  },
  apply: async (guildId, data) => {
    await upsertGuildEntity(AppDataSource.getRepository(AnnouncementConfig), guildId, {
      apply: config => {
        config.defaultRoleId = data.roleId;
        config.defaultChannelId = data.channelId;
      },
    });

    await seedDefaultTemplates(guildId);
  },
  toPartialData: data => ({
    roleId: data.roleId,
    channelId: data.channelId,
  }),
};

// --- Bait Channel ---

interface BaitData {
  channelId: string;
  actionType: BaitActionType;
  logChannelId?: string;
  /** Auto-create defaults to `true` (safe-by-default); manual path leaves the column untouched. */
  testMode: boolean;
}

const baitConfig: SimpleSystemConfig<BaitData, 'baitchannel'> = {
  systemKey: 'baitchannel',
  channelType: 'bait',
  systemLabel: 'Bait Channel System',
  loadingMessage: 'Creating bait channels...',
  fromAutoCreate: created => {
    if (!created.channel) return null;
    return {
      channelId: created.channel,
      actionType: 'log-only',
      logChannelId: created.log,
      testMode: true,
    };
  },
  buildModal: () =>
    rawModal(`setup_bait_${Date.now()}`, 'Bait Channel Setup', [
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
    ]),
  fromModal: submit => {
    const channelId = extractModalField(submit.fields, 'setup_bait_ch');
    if (!channelId) return { kind: 'insufficient' };
    const rawAction = extractModalField(submit.fields, 'setup_bait_action') || 'ban';
    const actionType = VALID_BAIT_ACTIONS.includes(rawAction as BaitActionType) ? (rawAction as BaitActionType) : 'ban';
    const logChannelId = extractModalField(submit.fields, 'setup_bait_log') || undefined;
    return {
      kind: 'complete',
      data: { channelId, actionType, logChannelId, testMode: false },
    };
  },
  apply: async (guildId, data, { guild, client }) => {
    const repo = AppDataSource.getRepository(BaitChannelConfig);
    let config = await repo.findOneBy({ guildId });
    if (!config) config = repo.create({ guildId, channelId: data.channelId });
    // Re-running setup via the always-visible /bot-setup dashboard must yield a
    // functional (enabled) config. An existing row may carry enabled=false from
    // /baitchannel toggle or a deleted bait channel (channelDelete auto-disables);
    // without this, command-gating would keep /baitchannel hidden with no
    // in-Discord way back. This makes the dashboard the guaranteed re-enable path.
    config.enabled = true;
    config.channelId = data.channelId;
    config.channelIds = [data.channelId];
    config.actionType = data.actionType;
    // Only set testMode when the auto-create path explicitly opts in. Manual
    // path leaves the column at whatever it was (default false on create).
    if (data.testMode) config.testMode = true;
    if (data.logChannelId) config.logChannelId = data.logChannelId;

    // Send warning message in the bait channel — must happen for both paths
    // (silently skipping it on the manual path was the v3.0.5-fixed bug).
    try {
      const baitChannel = (await guild.channels.fetch(data.channelId)) as TextChannel;
      const msg = await baitChannel.send({ content: BAIT_CHANNEL_WARNING });
      config.channelMessageId = msg.id;
    } catch {
      enhancedLogger.warn(
        'Failed to send warning message to bait channel during setup',
        LogCategory.COMMAND_EXECUTION,
        { guildId },
      );
    }

    await repo.save(config);

    // Seed default keywords (also a v3.0.5 fix for both paths)
    try {
      const { seedDefaultKeywords } = await import('../baitChannel/keywords');
      await seedDefaultKeywords(guildId);
    } catch {
      enhancedLogger.warn('Failed to seed default keywords during bait channel setup', LogCategory.COMMAND_EXECUTION);
    }

    (client as ExtendedClient).baitChannelManager?.clearConfigCache(guildId);
  },
  toPartialData: data => ({
    channelId: data.channelId,
    actionType: data.actionType,
    logChannelId: data.logChannelId,
  }),
};

// --- Memory ---

interface MemoryData {
  forumChannelId: string;
}

const memoryConfig: SimpleSystemConfig<MemoryData, 'memory'> = {
  systemKey: 'memory',
  channelType: 'memory',
  systemLabel: 'Memory System',
  loadingMessage: 'Creating memory forum channel...',
  fromAutoCreate: created => {
    if (!created.forum) return null;
    return { forumChannelId: created.forum };
  },
  buildModal: () =>
    rawModal(`setup_memory_${Date.now()}`, 'Memory System Setup', [
      labelWrap(
        'Memory Forum Channel',
        channelSelect('setup_memory_forum', [ChannelType.GuildForum]),
        'Forum channel for memory items',
      ),
    ]),
  fromModal: submit => {
    const forumChannelId = extractModalField(submit.fields, 'setup_memory_forum');
    if (!forumChannelId) return { kind: 'insufficient' };
    return { kind: 'complete', data: { forumChannelId } };
  },
  apply: async (guildId, data, { guild }) => {
    const repo = AppDataSource.getRepository(MemoryConfig);
    let config = await repo.findOneBy({ guildId });
    if (!config)
      config = repo.create({
        guildId,
        forumChannelId: data.forumChannelId,
        channelName: 'memory',
      });
    else config.forumChannelId = data.forumChannelId;
    await repo.save(config);

    // Seed default forum tags + create welcome thread (matches both auto & manual paths).
    try {
      const forum = (await guild.channels.fetch(data.forumChannelId)) as ForumChannel;
      await createDefaultMemoryTags(guildId, config.id, forum);

      const welcomeThread = await createMemoryWelcomeThread(forum);
      if (welcomeThread) {
        config.messageId = welcomeThread;
        await repo.save(config);
      }
    } catch (_error) {
      enhancedLogger.warn('Failed to seed default memory tags during setup', LogCategory.COMMAND_EXECUTION, {
        guildId,
      });
    }
  },
  toPartialData: data => ({ forumChannelId: data.forumChannelId }),
};

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

    await pinThreadBestEffort(thread);

    return thread.id;
  } catch {
    enhancedLogger.warn('Failed to create memory welcome thread', LogCategory.COMMAND_EXECUTION);
    return null;
  }
}

// --- Rules Acknowledgment ---

interface RulesData {
  channelId: string;
  emoji: string;
  roleId?: string;
}

// Rules is intentionally two-stage: /bot-setup captures channel + role, then
// /rules-setup wires the message + role binding. Always saved as 'partial'.
const rulesConfig: SimpleSystemConfig<RulesData, 'rules'> = {
  systemKey: 'rules',
  channelType: 'rules',
  systemLabel: 'Rules System',
  loadingMessage: 'Creating rules channel...',
  fromAutoCreate: created => {
    if (!created.channel) return null;
    return { channelId: created.channel, emoji: '✅' };
  },
  buildModal: () =>
    rawModal(`setup_rules_${Date.now()}`, 'Rules Setup', [
      labelWrap(
        'Rules Channel',
        channelSelect('setup_rules_ch', [ChannelType.GuildText]),
        'Channel for the rules message',
      ),
      labelWrap('Verified Role', roleSelect('setup_rules_role'), 'Role to give when user accepts rules'),
    ]),
  fromModal: submit => {
    const channelId = extractModalField(submit.fields, 'setup_rules_ch');
    const roleId = extractModalField(submit.fields, 'setup_rules_role');
    if (!channelId || !roleId) return { kind: 'insufficient' };
    // Both fields present, but rules still needs /rules-setup — save as partial.
    return { kind: 'partial', data: { channelId, roleId, emoji: '✅' } };
  },
  apply: async () => {
    // No-op: rules has no DB save during /bot-setup. /rules-setup handles
    // the message + role wiring. Auto-create reaches here with finalState='partial'.
  },
  toPartialData: data => ({
    channelId: data.channelId,
    emoji: data.emoji,
    ...(data.roleId ? { roleId: data.roleId } : {}),
  }),
  finalState: 'partial',
};

// --- Simple system descriptor table ---

const SIMPLE_SYSTEM_CONFIGS: {
  [K in SimpleSystemKey]: SimpleSystemConfig<any, K>;
} = {
  announcement: announcementConfig,
  baitchannel: baitConfig,
  memory: memoryConfig,
  rules: rulesConfig,
};

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
  // A dashboard flow just (un)configured a system — refresh the guild's
  // visible commands if its enabled-module set changed (debounced + no-op when
  // unchanged, so calling on every save is safe).
  requestGuildCommandRefresh(setupState.guildId);
}
