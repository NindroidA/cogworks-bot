/**
 * Comprehensive Bot Setup Wizard
 * Includes: Global Staff Role, Ticket System, Application System, Role Management
 */

import type { CategoryChannel, ChannelSelectMenuInteraction, Client, CommandInteraction, ForumChannel, MessageComponentInteraction, RoleSelectMenuInteraction, StringSelectMenuInteraction, TextChannel } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { SavedRole } from '../../../typeorm/entities/SavedRole';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { createButtonCollector, createErrorEmbed, createInfoEmbed, lang, logger } from '../../../utils';
import { BaitChannelManager } from '../../../utils/baitChannelManager';
import {
    announcementStep,
    applicationStep,
    baitChannelStep,
    buildRoleSelectionEmbed,
    buildRoleSelector,
    buildSuccessEmbed,
    roleStep,
    staffRoleStep,
    ticketStep,
    welcomeStep
} from './steps';

interface ComprehensiveWizardState {
    guildId: string;
    currentStep: 'welcome' | 'staff_role' | 'ticket' | 'application' | 'announcement' | 'baitchannel' | 'roles' | 'summary';
    config: Partial<BotConfig>;
    reconfigureMode?: boolean; // If true, ask about all systems even if configured
    ticketConfig?: {
        channelId?: string;
        categoryId?: string;
        archiveForumId?: string;
    };
    applicationConfig?: {
        channelId?: string;
        categoryId?: string;
        archiveForumId?: string;
    };
    announcementConfig?: {
        minecraftRoleId?: string;
        defaultChannelId?: string;
    };
    baitChannelConfig?: {
        channelId?: string;
        actionType?: string;
        gracePeriodSeconds?: number;
        logChannelId?: string;
    };
    roles: Array<{
        type: 'staff' | 'admin';
        role: string;
        alias?: string;
    }>;
    systemsConfigured: {
        ticket: boolean;
        application: boolean;
        announcement: boolean;
        baitchannel: boolean;
    };
    existingConfigs?: {
        botConfig?: BotConfig;
        ticketConfig?: TicketConfig;
        archivedTicketConfig?: ArchivedTicketConfig;
        applicationConfig?: ApplicationConfig;
        archivedApplicationConfig?: ArchivedApplicationConfig;
        announcementConfig?: AnnouncementConfig;
        baitChannelConfig?: BaitChannelConfig;
    };
}

export interface ExistingConfigs {
    existingBotConfig?: BotConfig;
    existingTicketConfig?: TicketConfig;
    existingArchivedTicketConfig?: ArchivedTicketConfig;
    existingApplicationConfig?: ApplicationConfig;
    existingArchivedApplicationConfig?: ArchivedApplicationConfig;
    existingAnnouncementConfig?: AnnouncementConfig;
    existingBaitChannelConfig?: BaitChannelConfig;
}

export async function startComprehensiveWizard(
    interaction: CommandInteraction | MessageComponentInteraction, 
    client: Client,
    existingConfigs?: ExistingConfigs,
    reconfigureMode = false // Set to true when user chooses "Reconfigure All"
) {
    const state: ComprehensiveWizardState = {
        guildId: interaction.guild!.id,
        currentStep: 'welcome',
        config: {},
        roles: [],
        reconfigureMode: reconfigureMode,
        systemsConfigured: {
            ticket: false,
            application: false,
            announcement: false,
            baitchannel: false
        },
        existingConfigs: existingConfigs ? {
            botConfig: existingConfigs.existingBotConfig,
            ticketConfig: existingConfigs.existingTicketConfig,
            archivedTicketConfig: existingConfigs.existingArchivedTicketConfig,
            applicationConfig: existingConfigs.existingApplicationConfig,
            archivedApplicationConfig: existingConfigs.existingArchivedApplicationConfig,
            announcementConfig: existingConfigs.existingAnnouncementConfig,
            baitChannelConfig: existingConfigs.existingBaitChannelConfig
        } : undefined
    };

    // Build custom welcome message if there are existing configs
    let welcomeEmbed;
    if (existingConfigs && (existingConfigs.existingBotConfig || existingConfigs.existingTicketConfig || existingConfigs.existingApplicationConfig || existingConfigs.existingAnnouncementConfig || existingConfigs.existingBaitChannelConfig)) {
        const alreadyConfigured = [];
        if (existingConfigs.existingBotConfig?.enableGlobalStaffRole) alreadyConfigured.push('• Global Staff Role');
        if (existingConfigs.existingTicketConfig && existingConfigs.existingArchivedTicketConfig) alreadyConfigured.push('• Ticket System');
        if (existingConfigs.existingApplicationConfig && existingConfigs.existingArchivedApplicationConfig) alreadyConfigured.push('• Application System');
        if (existingConfigs.existingAnnouncementConfig) alreadyConfigured.push('• Announcement System');
        if (existingConfigs.existingBaitChannelConfig) alreadyConfigured.push('• Bait Channel (Anti-Bot)');

        const toBeConfigured = [];
        if (!existingConfigs.existingBotConfig?.enableGlobalStaffRole) toBeConfigured.push('• Global Staff Role (optional)');
        if (!(existingConfigs.existingTicketConfig && existingConfigs.existingArchivedTicketConfig)) toBeConfigured.push('• Ticket System (optional)');
        if (!(existingConfigs.existingApplicationConfig && existingConfigs.existingArchivedApplicationConfig)) toBeConfigured.push('• Application System (optional)');
        if (!existingConfigs.existingAnnouncementConfig) toBeConfigured.push('• Announcement System (optional)');
        if (!existingConfigs.existingBaitChannelConfig) toBeConfigured.push('• Bait Channel System (optional)');
        toBeConfigured.push('• Staff & Admin Roles (optional)');

        welcomeEmbed = createInfoEmbed(
            lang.botSetup.welcome.continueTitle,
            lang.botSetup.welcome.continueDescription + '\n\n' +
            lang.botSetup.welcome.alreadyConfigured + '\n' +
            alreadyConfigured.join('\n') + '\n\n' +
            lang.botSetup.welcome.toBeConfigured + '\n' +
            toBeConfigured.join('\n') + '\n\n' +
            lang.botSetup.welcome.systemConfiguredSkip
        );
        welcomeEmbed.addFields({
            name: lang.botSetup.welcome.gettingStarted,
            value: lang.botSetup.welcome.continueCTA,
            inline: false
        });
    } else {
        welcomeEmbed = welcomeStep.buildEmbed();
    }
    
    const welcomeComponents = welcomeStep.buildComponents();

    // Handle both CommandInteraction and MessageComponentInteraction
    const reply = 'editReply' in interaction && interaction.deferred
        ? await interaction.editReply({
            embeds: [welcomeEmbed],
            components: welcomeComponents
        })
        : await interaction.reply({
            embeds: [welcomeEmbed],
            components: welcomeComponents,
            flags: [MessageFlags.Ephemeral],
            fetchReply: true
        });

    const collector = createButtonCollector(reply, 300_000); // 5 minutes

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'setup_start') {
            await buttonInteraction.deferUpdate();
            
            // Check if staff role is already configured
            if (state.existingConfigs?.botConfig?.enableGlobalStaffRole) {
                // Skip to ticket system if staff role exists
                state.config.enableGlobalStaffRole = state.existingConfigs.botConfig.enableGlobalStaffRole;
                state.config.globalStaffRole = state.existingConfigs.botConfig.globalStaffRole;
                state.currentStep = 'ticket';
                await handleTicketSystemStep(buttonInteraction, state, client);
            } else {
                state.currentStep = 'staff_role';
                await handleStaffRoleStep(buttonInteraction, state, client);
            }
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
            try {
                await interaction.editReply({
                    embeds: [createErrorEmbed(lang.botSetup.errors.timeout)],
                    components: []
                });
            } catch {
                // Interaction may have been deleted
            }
        }
    });
}

async function handleStaffRoleStep(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const staffEmbed = staffRoleStep.buildEmbed();
    const staffComponents = staffRoleStep.buildComponents();

    await interaction.editReply({
        embeds: [staffEmbed],
        components: staffComponents
    });

    const reply = await interaction.fetchReply();
    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'staff_role_enable') {
            await buttonInteraction.deferUpdate();
            state.config.enableGlobalStaffRole = true;
            await handleStaffRoleSelection(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'staff_role_skip') {
            await buttonInteraction.deferUpdate();
            state.config.enableGlobalStaffRole = false;
            state.config.globalStaffRole = null;
            state.currentStep = 'ticket';
            await handleTicketSystemStep(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });
}

async function handleStaffRoleSelection(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const roleEmbed = buildRoleSelectionEmbed();
    const roleSelector = buildRoleSelector();

    await interaction.editReply({
        embeds: [roleEmbed],
        components: [roleSelector]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        time: 300_000
    });

    collector.on('collect', async (roleInteraction: RoleSelectMenuInteraction) => {
        const selectedRole = roleInteraction.roles.first();
        
        if (!selectedRole) {
            await roleInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noRoleSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (selectedRole.id === roleInteraction.guild?.id) {
            await roleInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.everyoneNotAllowed)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await roleInteraction.deferUpdate();
        state.config.globalStaffRole = '<@&' + selectedRole.id + '>';
        state.currentStep = 'ticket';
        await handleTicketSystemStep(roleInteraction, state, client);
        collector.stop();
    });
}

async function handleTicketSystemStep(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    // Check if ticket system is already configured
    const ticketAlreadyConfigured = state.existingConfigs?.ticketConfig && state.existingConfigs?.archivedTicketConfig;
    
    // Only auto-skip if not in reconfigure mode
    if (ticketAlreadyConfigured && !state.reconfigureMode) {
        // Skip ticket setup and move to application
        state.systemsConfigured.ticket = true;
        state.currentStep = 'application';
        await handleApplicationSystemStep(interaction, state, client);
        return;
    }

    const ticketEmbed = ticketStep.buildEmbed();
    const ticketComponents = ticketStep.buildComponents();

    await interaction.editReply({
        embeds: [ticketEmbed],
        components: ticketComponents
    });

    const reply = await interaction.fetchReply();
    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'ticket_enable') {
            await buttonInteraction.deferUpdate();
            state.ticketConfig = {};
            await handleTicketChannelSelect(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'ticket_skip') {
            await buttonInteraction.deferUpdate();
            state.currentStep = 'application';
            await handleApplicationSystemStep(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });
}

async function handleTicketChannelSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const channelEmbed = ticketStep.buildChannelSelectEmbed();
    const channelSelect = ticketStep.buildChannelSelect();

    await interaction.editReply({
        embeds: [channelEmbed],
        components: [channelSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedChannel = channelInteraction.channels.first() as TextChannel;
        
        if (!selectedChannel) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noChannelSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.ticketConfig!.channelId = selectedChannel.id;
        await handleTicketCategorySelect(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleTicketCategorySelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const categoryEmbed = ticketStep.buildCategorySelectEmbed();
    const categorySelect = ticketStep.buildCategorySelect();

    await interaction.editReply({
        embeds: [categoryEmbed],
        components: [categorySelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedCategory = channelInteraction.channels.first() as CategoryChannel;
        
        if (!selectedCategory) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noCategorySelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.ticketConfig!.categoryId = selectedCategory.id;
        await handleTicketArchiveSelect(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleTicketArchiveSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const archiveEmbed = ticketStep.buildArchiveSelectEmbed();
    const archiveSelect = ticketStep.buildArchiveSelect();

    await interaction.editReply({
        embeds: [archiveEmbed],
        components: [archiveSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedForum = channelInteraction.channels.first() as ForumChannel;
        
        if (!selectedForum) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noForumSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.ticketConfig!.archiveForumId = selectedForum.id;
        
        // Save ticket configuration
        await saveTicketConfiguration(state, client);
        state.systemsConfigured.ticket = true;
        
        // Move to application setup
        state.currentStep = 'application';
        await handleApplicationSystemStep(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleApplicationSystemStep(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    // Check if application system is already configured
    const applicationAlreadyConfigured = state.existingConfigs?.applicationConfig && state.existingConfigs?.archivedApplicationConfig;
    
    // Only auto-skip if not in reconfigure mode
    if (applicationAlreadyConfigured && !state.reconfigureMode) {
        // Skip application setup and move to announcement
        state.systemsConfigured.application = true;
        state.currentStep = 'announcement';
        await handleAnnouncementSystemStep(interaction, state, client);
        return;
    }

    const appEmbed = applicationStep.buildEmbed();
    const appComponents = applicationStep.buildComponents();

    await interaction.editReply({
        embeds: [appEmbed],
        components: appComponents
    });

    const reply = await interaction.fetchReply();
    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'application_enable') {
            await buttonInteraction.deferUpdate();
            state.applicationConfig = {};
            await handleApplicationChannelSelect(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'application_skip') {
            await buttonInteraction.deferUpdate();
            state.currentStep = 'announcement';
            await handleAnnouncementSystemStep(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });
}

async function handleApplicationChannelSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const channelEmbed = applicationStep.buildChannelSelectEmbed();
    const channelSelect = applicationStep.buildChannelSelect();

    await interaction.editReply({
        embeds: [channelEmbed],
        components: [channelSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedChannel = channelInteraction.channels.first() as TextChannel;
        
        if (!selectedChannel) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noChannelSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.applicationConfig!.channelId = selectedChannel.id;
        await handleApplicationCategorySelect(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleApplicationCategorySelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const categoryEmbed = applicationStep.buildCategorySelectEmbed();
    const categorySelect = applicationStep.buildCategorySelect();

    await interaction.editReply({
        embeds: [categoryEmbed],
        components: [categorySelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedCategory = channelInteraction.channels.first() as CategoryChannel;
        
        if (!selectedCategory) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noCategorySelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.applicationConfig!.categoryId = selectedCategory.id;
        await handleApplicationArchiveSelect(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleApplicationArchiveSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const archiveEmbed = applicationStep.buildArchiveSelectEmbed();
    const archiveSelect = applicationStep.buildArchiveSelect();

    await interaction.editReply({
        embeds: [archiveEmbed],
        components: [archiveSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedForum = channelInteraction.channels.first() as ForumChannel;
        
        if (!selectedForum) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noForumSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.applicationConfig!.archiveForumId = selectedForum.id;
        
        // Save application configuration
        await saveApplicationConfiguration(state, client);
        state.systemsConfigured.application = true;
        
        // Move to announcement
        state.currentStep = 'announcement';
        await handleAnnouncementSystemStep(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleAnnouncementSystemStep(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    // Check if announcement system is already configured
    const announcementAlreadyConfigured = state.existingConfigs?.announcementConfig;
    
    // Only auto-skip if not in reconfigure mode
    if (announcementAlreadyConfigured && !state.reconfigureMode) {
        // Skip announcement setup and move to bait channel
        state.systemsConfigured.announcement = true;
        state.currentStep = 'baitchannel';
        await handleBaitChannelSystemStep(interaction, state, client);
        return;
    }

    const announcementEmbed = announcementStep.buildEmbed();
    const announcementComponents = announcementStep.buildComponents();

    await interaction.editReply({
        embeds: [announcementEmbed],
        components: announcementComponents
    });

    const reply = await interaction.fetchReply();
    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'announcement_enable') {
            await buttonInteraction.deferUpdate();
            state.announcementConfig = {};
            await handleAnnouncementRoleSelect(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'announcement_skip') {
            await buttonInteraction.deferUpdate();
            state.currentStep = 'baitchannel';
            await handleBaitChannelSystemStep(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });
}

async function handleAnnouncementRoleSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const roleEmbed = announcementStep.buildRoleSelectEmbed();
    const roleSelect = announcementStep.buildRoleSelect();

    await interaction.editReply({
        embeds: [roleEmbed],
        components: [roleSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        time: 300_000
    });

    collector.on('collect', async (roleInteraction: RoleSelectMenuInteraction) => {
        const selectedRole = roleInteraction.roles.first();
        
        if (!selectedRole) {
            await roleInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noRoleSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await roleInteraction.deferUpdate();
        state.announcementConfig!.minecraftRoleId = selectedRole.id;
        await handleAnnouncementChannelSelect(roleInteraction, state, client);
        collector.stop();
    });
}

async function handleAnnouncementChannelSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const channelEmbed = announcementStep.buildChannelSelectEmbed();
    const channelSelect = announcementStep.buildChannelSelect();

    await interaction.editReply({
        embeds: [channelEmbed],
        components: [channelSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedChannel = channelInteraction.channels.first() as TextChannel;
        
        if (!selectedChannel) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noChannelSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.announcementConfig!.defaultChannelId = selectedChannel.id;
        
        // Save announcement configuration
        await saveAnnouncementConfiguration(state, client);
        state.systemsConfigured.announcement = true;
        
        // Move to bait channel
        state.currentStep = 'baitchannel';
        await handleBaitChannelSystemStep(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleBaitChannelSystemStep(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    // Check if bait channel is already configured
    const baitChannelAlreadyConfigured = state.existingConfigs?.baitChannelConfig;
    
    // Auto-skip only if configured AND not in reconfigure mode
    if (baitChannelAlreadyConfigured && !state.reconfigureMode) {
        // Skip bait channel setup and move to roles
        state.systemsConfigured.baitchannel = true;
        state.currentStep = 'roles';
        await handleRoleManagementStep(interaction, state, client);
        return;
    }

    const baitChannelEmbed = baitChannelStep.buildEmbed();
    const baitChannelComponents = baitChannelStep.buildComponents();

    await interaction.editReply({
        embeds: [baitChannelEmbed],
        components: baitChannelComponents
    });

    const reply = await interaction.fetchReply();
    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'baitchannel_enable') {
            await buttonInteraction.deferUpdate();
            state.baitChannelConfig = {};
            await handleBaitChannelSelect(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'baitchannel_skip') {
            await buttonInteraction.deferUpdate();
            state.currentStep = 'roles';
            await handleRoleManagementStep(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });
}

async function handleBaitChannelSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const channelEmbed = baitChannelStep.buildChannelSelectEmbed();
    const channelSelect = baitChannelStep.buildChannelSelect();

    await interaction.editReply({
        embeds: [channelEmbed],
        components: [channelSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    collector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedChannel = channelInteraction.channels.first() as TextChannel;
        
        if (!selectedChannel) {
            await channelInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noChannelSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await channelInteraction.deferUpdate();
        state.baitChannelConfig!.channelId = selectedChannel.id;
        await handleBaitChannelActionSelect(channelInteraction, state, client);
        collector.stop();
    });
}

async function handleBaitChannelActionSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const actionEmbed = baitChannelStep.buildActionSelectEmbed();
    const actionSelect = baitChannelStep.buildActionSelect();

    await interaction.editReply({
        embeds: [actionEmbed],
        components: [actionSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 300_000
    });

    collector.on('collect', async (selectInteraction: StringSelectMenuInteraction) => {
        const selectedAction = selectInteraction.values[0];
        
        if (!selectedAction) {
            await selectInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noActionSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await selectInteraction.deferUpdate();
        state.baitChannelConfig!.actionType = selectedAction;
        await handleBaitChannelGracePeriodSelect(selectInteraction, state, client);
        collector.stop();
    });
}

async function handleBaitChannelGracePeriodSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const graceEmbed = baitChannelStep.buildGracePeriodEmbed();
    const graceSelect = baitChannelStep.buildGracePeriodSelect();

    await interaction.editReply({
        embeds: [graceEmbed],
        components: [graceSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 300_000
    });

    collector.on('collect', async (selectInteraction: StringSelectMenuInteraction) => {
        const selectedGrace = selectInteraction.values[0];
        
        if (!selectedGrace) {
            await selectInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noGracePeriodSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await selectInteraction.deferUpdate();
        state.baitChannelConfig!.gracePeriodSeconds = parseInt(selectedGrace);
        await handleBaitChannelLogSelect(selectInteraction, state, client);
        collector.stop();
    });
}

async function handleBaitChannelLogSelect(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const logEmbed = baitChannelStep.buildLogChannelSelectEmbed();
    const logSelect = baitChannelStep.buildLogChannelSelect();
    const skipButton = baitChannelStep.buildLogChannelSkipButton();

    await interaction.editReply({
        embeds: [logEmbed],
        components: [logSelect, skipButton]
    });

    const reply = await interaction.fetchReply();
    
    // Collect both channel select and button
    const channelCollector = reply.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        time: 300_000
    });

    const buttonCollector = createButtonCollector(reply, 300_000);

    channelCollector.on('collect', async (channelInteraction: ChannelSelectMenuInteraction) => {
        const selectedChannel = channelInteraction.channels.first() as TextChannel;
        
        if (selectedChannel) {
            await channelInteraction.deferUpdate();
            state.baitChannelConfig!.logChannelId = selectedChannel.id;
            
            // Save bait channel configuration
            await saveBaitChannelConfiguration(state, client);
            state.systemsConfigured.baitchannel = true;
            
            // Move to role management
            state.currentStep = 'roles';
            await handleRoleManagementStep(channelInteraction, state, client);
            channelCollector.stop();
            buttonCollector.stop();
        }
    });

    buttonCollector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'baitchannel_log_skip') {
            await buttonInteraction.deferUpdate();
            
            // Save bait channel configuration without log channel
            await saveBaitChannelConfiguration(state, client);
            state.systemsConfigured.baitchannel = true;
            
            // Move to role management
            state.currentStep = 'roles';
            await handleRoleManagementStep(buttonInteraction, state, client);
            channelCollector.stop();
            buttonCollector.stop();
        }
    });
}

async function handleRoleManagementStep(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const roleEmbed = roleStep.buildEmbed();
    const roleComponents = roleStep.buildComponents();

    await interaction.editReply({
        embeds: [roleEmbed],
        components: roleComponents
    });

    const reply = await interaction.fetchReply();
    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'role_enable') {
            await buttonInteraction.deferUpdate();
            await handleRoleTypeSelection(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'role_skip') {
            await buttonInteraction.deferUpdate();
            state.currentStep = 'summary';
            await handleFinalSummary(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });

    collector.on('end', async (_collected, reason) => {
        if (reason === 'time') {
            try {
                await interaction.editReply({
                    embeds: [createErrorEmbed(lang.botSetup.errors.timeoutInactivity)],
                    components: []
                });
            } catch (error) {
                logger(lang.botSetup.logs.couldNotEditOnTimeout + error, 'WARN');
            }
        }
    });
}

async function handleRoleTypeSelection(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const typeEmbed = roleStep.buildRoleTypeEmbed();
    const typeSelect = roleStep.buildRoleTypeSelect();

    await interaction.editReply({
        embeds: [typeEmbed],
        components: [typeSelect]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 300_000
    });

    collector.on('collect', async (selectInteraction: StringSelectMenuInteraction) => {
        const roleType = selectInteraction.values[0] as 'staff' | 'admin';
        
        await selectInteraction.deferUpdate();
        await handleRoleSelection(selectInteraction, state, client, roleType);
        collector.stop();
    });
}

async function handleRoleSelection(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client, roleType: 'staff' | 'admin') {
    const roleEmbed = roleStep.buildRoleSelectEmbed(roleType);
    const roleSelector = roleStep.buildRoleSelect();

    await interaction.editReply({
        embeds: [roleEmbed],
        components: [roleSelector]
    });

    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        time: 300_000
    });

    collector.on('collect', async (roleInteraction: RoleSelectMenuInteraction) => {
        const selectedRole = roleInteraction.roles.first();
        
        if (!selectedRole) {
            await roleInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.noRoleSelected)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (selectedRole.id === roleInteraction.guild?.id) {
            await roleInteraction.reply({
                embeds: [createErrorEmbed(lang.botSetup.errors.everyoneNotAllowedGeneric)],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Show modal for alias
        const modal = new ModalBuilder()
            .setCustomId('role_alias_modal_' + roleType + '_' + selectedRole.id)
            .setTitle('Role Alias (Optional)');

        const aliasInput = new TextInputBuilder()
            .setCustomId('alias_input')
            .setLabel('Alias for this role (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('e.g., Moderator, Helper, etc.');

        const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(aliasInput);
        modal.addComponents(actionRow);

        await roleInteraction.showModal(modal);

        // Handle modal submission
        const modalSubmit = await roleInteraction.awaitModalSubmit({
            filter: (i) => i.customId === modal.data.custom_id,
            time: 60_000
        }).catch(() => null);

        if (modalSubmit) {
            await modalSubmit.deferUpdate();
            const alias = modalSubmit.fields.getTextInputValue('alias_input') || undefined;
            
            // Add role to state
            state.roles.push({
                type: roleType,
                role: '<@&' + selectedRole.id + '>',
                alias
            });

            // Show "add more" prompt - cast modalSubmit to MessageComponentInteraction
            await handleAddMoreRoles(modalSubmit as unknown as MessageComponentInteraction, state, client);
        }

        collector.stop();
    });
}

async function handleAddMoreRoles(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, client: Client) {
    const addMoreEmbed = roleStep.buildAddMoreEmbed(state.roles);
    const addMoreButtons = roleStep.buildAddMoreButtons();

    await interaction.editReply({
        embeds: [addMoreEmbed],
        components: addMoreButtons
    });

    const reply = await interaction.fetchReply();
    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'role_add_more') {
            await buttonInteraction.deferUpdate();
            await handleRoleTypeSelection(buttonInteraction, state, client);
            collector.stop();
        } else if (buttonInteraction.customId === 'role_done') {
            await buttonInteraction.deferUpdate();
            
            try {
                // Save all roles
                await saveRoles(state);
                
                state.currentStep = 'summary';
                await handleFinalSummary(buttonInteraction, state, client);
                collector.stop();
            } catch (error) {
                logger(lang.botSetup.errors.roleAddError + error, 'ERROR');
                await buttonInteraction.editReply({
                    embeds: [createErrorEmbed(lang.botSetup.errors.roleAddError)],
                    components: []
                });
                collector.stop();
            }
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });

    collector.on('end', async (_collected, reason) => {
        if (reason === 'time') {
            try {
                await interaction.editReply({
                    embeds: [createErrorEmbed(lang.botSetup.errors.timeoutInactivity)],
                    components: []
                });
            } catch (error) {
                logger(lang.botSetup.logs.couldNotEditOnTimeout + error, 'WARN');
            }
        }
    });
}

async function handleFinalSummary(interaction: MessageComponentInteraction, state: ComprehensiveWizardState, _client: Client) {
    // Save bot config if not already saved
    await saveBotConfiguration(state);

    // Build custom success message showing what was already configured vs newly configured
    const alreadyConfigured = [];
    const newlyConfigured = [];

    // Check what was already configured
    if (state.existingConfigs?.botConfig?.enableGlobalStaffRole) {
        alreadyConfigured.push('Global Staff Role');
    } else if (state.config.enableGlobalStaffRole) {
        newlyConfigured.push('Global Staff Role');
    }

    if (state.existingConfigs?.ticketConfig && state.existingConfigs?.archivedTicketConfig) {
        alreadyConfigured.push('Ticket System');
    } else if (state.systemsConfigured.ticket) {
        newlyConfigured.push('Ticket System');
    }

    if (state.existingConfigs?.applicationConfig && state.existingConfigs?.archivedApplicationConfig) {
        alreadyConfigured.push('Application System');
    } else if (state.systemsConfigured.application) {
        newlyConfigured.push('Application System');
    }

    if (state.existingConfigs?.announcementConfig) {
        alreadyConfigured.push('Announcement System');
    } else if (state.systemsConfigured.announcement) {
        newlyConfigured.push('Announcement System');
    }

    if (state.existingConfigs?.baitChannelConfig) {
        alreadyConfigured.push('Bait Channel (Anti-Bot)');
    } else if (state.systemsConfigured.baitchannel) {
        newlyConfigured.push('Bait Channel (Anti-Bot)');
    }

    if (state.roles.length > 0) {
        newlyConfigured.push(`${state.roles.length} Role(s)`);
    }

    const successEmbed = buildSuccessEmbed(state.config, {
        ticketConfigured: state.systemsConfigured.ticket || !!(state.existingConfigs?.ticketConfig),
        applicationConfigured: state.systemsConfigured.application || !!(state.existingConfigs?.applicationConfig),
        announcementConfigured: state.systemsConfigured.announcement || !!(state.existingConfigs?.announcementConfig),
        baitChannelConfigured: state.systemsConfigured.baitchannel || !!(state.existingConfigs?.baitChannelConfig),
        rolesAdded: state.roles.length
    });

    // Add field showing what was already configured if applicable
    if (alreadyConfigured.length > 0) {
        successEmbed.addFields({
            name: '✅ Already Configured',
            value: alreadyConfigured.map(s => `• ${s}`).join('\n'),
            inline: false
        });
    }

    // Add field showing what was newly configured
    if (newlyConfigured.length > 0) {
        successEmbed.addFields({
            name: '🆕 Newly Configured',
            value: newlyConfigured.map(s => `• ${s}`).join('\n'),
            inline: false
        });
    }

    await interaction.editReply({
        embeds: [successEmbed],
        components: []
    });
}

async function saveBotConfiguration(state: ComprehensiveWizardState) {
    try {
        const botConfigRepo = AppDataSource.getRepository(BotConfig);
        
        let config = await botConfigRepo.findOne({ where: { guildId: state.guildId } });
        
        if (!config) {
            config = new BotConfig();
            config.guildId = state.guildId;
        }
        
        config.enableGlobalStaffRole = state.config.enableGlobalStaffRole ?? false;
        config.globalStaffRole = state.config.globalStaffRole ?? null;

        await botConfigRepo.save(config);
    } catch (error) {
        logger(lang.botSetup.errors.savingBotConfig + error, 'ERROR');
        throw error;
    }
}

async function saveTicketConfiguration(state: ComprehensiveWizardState, client: Client) {
    if (!state.ticketConfig) return;

    try {
        const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
        const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);

        // Setup main ticket channel
        const channel = await client.channels.fetch(state.ticketConfig.channelId!) as TextChannel;
        if (channel) {
            const createTicketButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setEmoji('🎫')
                    .setLabel('Create Ticket')
                    .setStyle(ButtonStyle.Primary)
            );

            const msg = await channel.send({
                content: lang.ticketSetup.createTicket,
                components: [createTicketButton]
            });

            let ticketConfig = await ticketConfigRepo.findOne({ where: { guildId: state.guildId } });
            if (!ticketConfig) {
                ticketConfig = new TicketConfig();
                ticketConfig.guildId = state.guildId;
            }
            
            ticketConfig.messageId = msg.id;
            ticketConfig.channelId = channel.id;
            ticketConfig.categoryId = state.ticketConfig.categoryId!;

            await ticketConfigRepo.save(ticketConfig);
        }

        // Setup archive forum
        const archiveForum = await client.channels.fetch(state.ticketConfig.archiveForumId!) as ForumChannel;
        if (archiveForum) {
            const msg = await archiveForum.threads.create({
                name: 'Ticket Archive',
                message: {
                    content: lang.botSetup.ticket.archiveMsg
                }
            });

            // Try to pin
            try {
                await msg.pin();
            } catch {
                logger(lang.botSetup.logs.couldNotPin, 'WARN');
            }

            let archivedConfig = await archivedTicketConfigRepo.findOne({ where: { guildId: state.guildId } });
            if (!archivedConfig) {
                archivedConfig = new ArchivedTicketConfig();
                archivedConfig.guildId = state.guildId;
            }

            archivedConfig.channelId = archiveForum.id;
            archivedConfig.messageId = msg.id;

            await archivedTicketConfigRepo.save(archivedConfig);
        }

    } catch (error) {
        logger(lang.botSetup.errors.savingTicketConfig + error, 'ERROR');
        throw error;
    }
}

async function saveApplicationConfiguration(state: ComprehensiveWizardState, client: Client) {
    if (!state.applicationConfig) return;

    try {
        const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
        const archivedApplicationConfigRepo = AppDataSource.getRepository(ArchivedApplicationConfig);

        // Setup main application channel
        const channel = await client.channels.fetch(state.applicationConfig.channelId!) as TextChannel;
        if (channel) {
            const msg = await channel.send({
                content: lang.botSetup.application.buttonMsg,
                components: []
            });

            let appConfig = await applicationConfigRepo.findOne({ where: { guildId: state.guildId } });
            if (!appConfig) {
                appConfig = new ApplicationConfig();
                appConfig.guildId = state.guildId;
            }
            
            appConfig.messageId = msg.id;
            appConfig.channelId = channel.id;
            appConfig.categoryId = state.applicationConfig.categoryId!;

            await applicationConfigRepo.save(appConfig);
        }

        // Setup archive forum
        const archiveForum = await client.channels.fetch(state.applicationConfig.archiveForumId!) as ForumChannel;
        if (archiveForum) {
            const msg = await archiveForum.threads.create({
                name: 'Application Archive',
                message: {
                    content: lang.botSetup.application.archiveMsg
                }
            });

            // Try to pin
            try {
                await msg.pin();
            } catch {
                logger(lang.botSetup.logs.couldNotPin, 'WARN');
            }

            let archivedConfig = await archivedApplicationConfigRepo.findOne({ where: { guildId: state.guildId } });
            if (!archivedConfig) {
                archivedConfig = new ArchivedApplicationConfig();
                archivedConfig.guildId = state.guildId;
            }

            archivedConfig.channelId = archiveForum.id;
            archivedConfig.messageId = msg.id;

            await archivedApplicationConfigRepo.save(archivedConfig);
        }

    } catch (error) {
        logger(lang.botSetup.errors.savingApplicationConfig + error, 'ERROR');
        throw error;
    }
}

async function saveAnnouncementConfiguration(state: ComprehensiveWizardState, _client: Client) {
    if (!state.announcementConfig) return;

    try {
        const announcementConfigRepo = AppDataSource.getRepository(AnnouncementConfig);

        let announcementConfig = await announcementConfigRepo.findOne({ where: { guildId: state.guildId } });
        if (!announcementConfig) {
            announcementConfig = new AnnouncementConfig();
            announcementConfig.guildId = state.guildId;
        }
        
        announcementConfig.minecraftRoleId = state.announcementConfig.minecraftRoleId!;
        announcementConfig.defaultChannelId = state.announcementConfig.defaultChannelId!;

        await announcementConfigRepo.save(announcementConfig);

    } catch (error) {
        logger(lang.botSetup.errors.savingAnnouncementConfig + error, 'ERROR');
        throw error;
    }
}

async function saveBaitChannelConfiguration(state: ComprehensiveWizardState, client: Client) {
    if (!state.baitChannelConfig) return;

    try {
        const baitChannelConfigRepo = AppDataSource.getRepository(BaitChannelConfig);

        let baitChannelConfig = await baitChannelConfigRepo.findOne({ where: { guildId: state.guildId } });
        if (!baitChannelConfig) {
            baitChannelConfig = new BaitChannelConfig();
            baitChannelConfig.guildId = state.guildId;
        }
        
        baitChannelConfig.channelId = state.baitChannelConfig.channelId!;
        baitChannelConfig.actionType = state.baitChannelConfig.actionType!;
        baitChannelConfig.gracePeriodSeconds = state.baitChannelConfig.gracePeriodSeconds!;
        baitChannelConfig.enabled = true;
        
        if (state.baitChannelConfig.logChannelId) {
            baitChannelConfig.logChannelId = state.baitChannelConfig.logChannelId;
        }

        await baitChannelConfigRepo.save(baitChannelConfig);
        logger(lang.botSetup.logs.baitChannelSaved
            .replace('{channelId}', baitChannelConfig.channelId)
            .replace('{enabled}', baitChannelConfig.enabled.toString()), 'INFO');

        // Send setup message to the bait channel
        const guild = await client.guilds.fetch(state.guildId);
        const baitChannel = await guild.channels.fetch(state.baitChannelConfig.channelId!) as TextChannel;
        
        if (baitChannel) {
            const configValue = lang.botSetup.baitChannel.setupEmbedConfigValue
                .replace('{actionType}', baitChannelConfig.actionType)
                .replace('{gracePeriod}', baitChannelConfig.gracePeriodSeconds.toString());
            
            const setupEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(lang.botSetup.baitChannel.setupEmbedTitle)
                .setDescription(lang.botSetup.baitChannel.setupEmbedDescription)
                .addFields(
                    { 
                        name: lang.botSetup.baitChannel.setupEmbedConfig, 
                        value: configValue
                    },
                    {
                        name: lang.botSetup.baitChannel.setupEmbedWarning,
                        value: lang.botSetup.baitChannel.setupEmbedWarningValue
                    }
                )
                .setTimestamp()
                .setFooter({ text: guild.name });

            await baitChannel.send({ embeds: [setupEmbed] });
        }

        // Clear the bait channel manager's config cache so it picks up the new config
        const baitChannelManager = (client as typeof client & { baitChannelManager?: BaitChannelManager }).baitChannelManager;
        if (baitChannelManager) {
            baitChannelManager.clearConfigCache(state.guildId);
            logger(lang.botSetup.logs.baitChannelCacheCleared, 'INFO');
        }

    } catch (error) {
        logger(lang.botSetup.errors.savingBaitChannelConfig + error, 'ERROR');
        throw error;
    }
}

async function saveRoles(state: ComprehensiveWizardState) {
    if (state.roles.length === 0) return;

    try {
        const savedRoleRepo = AppDataSource.getRepository(SavedRole);

        for (const roleData of state.roles) {
            // Check if role already exists
            const existing = await savedRoleRepo.findOne({ where: { role: roleData.role } });
            if (existing) continue; // Skip if already added

            const savedRole = new SavedRole();
            savedRole.guildId = state.guildId;
            savedRole.type = roleData.type;
            savedRole.role = roleData.role;
            savedRole.alias = roleData.alias || '';

            await savedRoleRepo.save(savedRole);
        }

    } catch (error) {
        logger(lang.botSetup.errors.savingRoles + error, 'ERROR');
        throw error;
    }
}

async function handleCancel(interaction: MessageComponentInteraction) {
    await interaction.update({
        embeds: [createInfoEmbed(lang.botSetup.cancel.title, lang.botSetup.cancel.message)],
        components: []
    });
}
