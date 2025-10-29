/**
 * Bot Setup Handler - Main Wizard Logic
 */

import type { CacheType, ChatInputCommandInteraction, Client, CommandInteraction, MessageComponentInteraction, RoleSelectMenuInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { createButtonCollector, createErrorEmbed, createInfoEmbed, createRateLimitKey, lang, logger, rateLimiter, RateLimits } from '../../../utils';
import { startComprehensiveWizard } from './comprehensiveWizard';
import {
    buildRoleSelectionEmbed,
    buildRoleSelector
} from './steps';

export async function botSetupHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({
            embeds: [createErrorEmbed('This command can only be used in a server!')],
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Rate limit check (5 bot setups per hour per guild)
    const rateLimitKey = createRateLimitKey.guild(interaction.guild.id, 'bot-setup');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BOT_SETUP);
    
    if (!rateCheck.allowed) {
        await interaction.reply({
            embeds: [createErrorEmbed(
                `⏱️ Bot setup is being modified too frequently. Please try again in ${Math.ceil((rateCheck.resetIn || 0) / 60000)} minutes.`
            )],
            flags: [MessageFlags.Ephemeral]
        });
        logger(`Rate limit exceeded for bot setup in guild ${interaction.guild.id}`, 'WARN');
        return;
    }

    // Check all existing configurations
    const botConfigRepository = AppDataSource.getRepository(BotConfig);
    const ticketConfigRepository = AppDataSource.getRepository(TicketConfig);
    const archivedTicketConfigRepository = AppDataSource.getRepository(ArchivedTicketConfig);
    const applicationConfigRepository = AppDataSource.getRepository(ApplicationConfig);
    const archivedApplicationConfigRepository = AppDataSource.getRepository(ArchivedApplicationConfig);
    const announcementConfigRepository = AppDataSource.getRepository(AnnouncementConfig);
    const baitChannelConfigRepository = AppDataSource.getRepository(BaitChannelConfig);

    const existingConfig = await botConfigRepository.findOne({
        where: { guildId: interaction.guild.id }
    });

    const existingTicketConfig = await ticketConfigRepository.findOne({
        where: { guildId: interaction.guild.id }
    });

    const existingArchivedTicketConfig = await archivedTicketConfigRepository.findOne({
        where: { guildId: interaction.guild.id }
    });

    const existingApplicationConfig = await applicationConfigRepository.findOne({
        where: { guildId: interaction.guild.id }
    });

    const existingArchivedApplicationConfig = await archivedApplicationConfigRepository.findOne({
        where: { guildId: interaction.guild.id }
    });

    const existingAnnouncementConfig = await announcementConfigRepository.findOne({
        where: { guildId: interaction.guild.id }
    });

    const existingBaitChannelConfig = await baitChannelConfigRepository.findOne({
        where: { guildId: interaction.guild.id }
    });

    // Check if we have partial configuration (bot config exists but other systems don't)
    const hasPartialConfig = existingConfig && (
        !existingTicketConfig || 
        !existingArchivedTicketConfig || 
        !existingApplicationConfig || 
        !existingArchivedApplicationConfig ||
        !existingAnnouncementConfig ||
        !existingBaitChannelConfig
    );

    // If bot config exists but other systems might be missing, use comprehensive wizard
    if (hasPartialConfig) {
        await startComprehensiveWizard(interaction, client, {
            existingBotConfig: existingConfig,
            existingTicketConfig: existingTicketConfig ?? undefined,
            existingArchivedTicketConfig: existingArchivedTicketConfig ?? undefined,
            existingApplicationConfig: existingApplicationConfig ?? undefined,
            existingArchivedApplicationConfig: existingArchivedApplicationConfig ?? undefined,
            existingAnnouncementConfig: existingAnnouncementConfig ?? undefined,
            existingBaitChannelConfig: existingBaitChannelConfig ?? undefined
        });
        return;
    }

    // If bot config exists and all systems are configured, show enhanced update mode
    if (existingConfig) {
        await handleEnhancedUpdateMode(interaction, client, {
            existingBotConfig: existingConfig,
            existingTicketConfig: existingTicketConfig ?? undefined,
            existingArchivedTicketConfig: existingArchivedTicketConfig ?? undefined,
            existingApplicationConfig: existingApplicationConfig ?? undefined,
            existingArchivedApplicationConfig: existingArchivedApplicationConfig ?? undefined,
            existingAnnouncementConfig: existingAnnouncementConfig ?? undefined,
            existingBaitChannelConfig: existingBaitChannelConfig ?? undefined
        });
        return;
    }

    // Use comprehensive wizard for initial setup (no existing configs)
    await startComprehensiveWizard(interaction, client);
}

// Enhanced update mode - shows what's configured and allows reconfiguring or adding missing systems

async function handleEnhancedUpdateMode(
    interaction: CommandInteraction,
    client: Client,
    existingConfigs: {
        existingBotConfig?: BotConfig;
        existingTicketConfig?: TicketConfig;
        existingArchivedTicketConfig?: ArchivedTicketConfig;
        existingApplicationConfig?: ApplicationConfig;
        existingArchivedApplicationConfig?: ArchivedApplicationConfig;
        existingAnnouncementConfig?: AnnouncementConfig;
        existingBaitChannelConfig?: BaitChannelConfig;
    }
) {
    // Build status embed showing all systems
    const statusLines: string[] = [];
    
    // Check each system
    const hasStaffRole = existingConfigs.existingBotConfig?.enableGlobalStaffRole;
    const hasTicket = existingConfigs.existingTicketConfig && existingConfigs.existingArchivedTicketConfig;
    const hasApplication = existingConfigs.existingApplicationConfig && existingConfigs.existingArchivedApplicationConfig;
    const hasAnnouncement = existingConfigs.existingAnnouncementConfig;
    const hasBaitChannel = existingConfigs.existingBaitChannelConfig;

    statusLines.push('**Current Configuration:**\n');
    
    statusLines.push(hasStaffRole 
        ? `✅ **Global Staff Role**: ${existingConfigs.existingBotConfig!.globalStaffRole}`
        : '❌ **Global Staff Role**: Not configured');
    
    statusLines.push(hasTicket 
        ? '✅ **Ticket System**: Configured'
        : '❌ **Ticket System**: Not configured');
    
    statusLines.push(hasApplication 
        ? '✅ **Application System**: Configured'
        : '❌ **Application System**: Not configured');
    
    statusLines.push(hasAnnouncement 
        ? '✅ **Announcement System**: Configured'
        : '❌ **Announcement System**: Not configured');
    
    statusLines.push(hasBaitChannel 
        ? '✅ **Bait Channel (Anti-Bot)**: Configured'
        : '❌ **Bait Channel (Anti-Bot)**: Not configured');

    statusLines.push('\n**What would you like to do?**');
    
    const updateEmbed = createInfoEmbed(
        '🔧 Bot Configuration Manager',
        statusLines.join('\n')
    );

    // Build buttons for each action
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('update_reconfigure_all')
            .setLabel('Reconfigure All Systems')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('update_add_missing')
            .setLabel('Add Missing Systems')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕')
    );

    const moreButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('update_staff_role_only')
            .setLabel('Update Staff Role')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥'),
        new ButtonBuilder()
            .setCustomId('setup_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const reply = await interaction.reply({
        embeds: [updateEmbed],
        components: [buttons, moreButtons],
        flags: [MessageFlags.Ephemeral],
        fetchReply: true
    });

    const collector = createButtonCollector(reply, 300_000);

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.customId === 'update_reconfigure_all') {
            // Run full wizard in reconfigure mode (asks about all systems)
            await buttonInteraction.deferUpdate();
            collector.stop();
            await startComprehensiveWizard(buttonInteraction, client, existingConfigs, true);
        } else if (buttonInteraction.customId === 'update_add_missing') {
            // Only configure missing systems
            await buttonInteraction.deferUpdate();
            collector.stop();
            
            // Create a config object that marks existing systems as configured
            const partialConfigs = {
                existingBotConfig: hasStaffRole ? existingConfigs.existingBotConfig : undefined,
                existingTicketConfig: hasTicket ? existingConfigs.existingTicketConfig : undefined,
                existingArchivedTicketConfig: hasTicket ? existingConfigs.existingArchivedTicketConfig : undefined,
                existingApplicationConfig: hasApplication ? existingConfigs.existingApplicationConfig : undefined,
                existingArchivedApplicationConfig: hasApplication ? existingConfigs.existingArchivedApplicationConfig : undefined,
                existingAnnouncementConfig: hasAnnouncement ? existingConfigs.existingAnnouncementConfig : undefined,
                existingBaitChannelConfig: hasBaitChannel ? existingConfigs.existingBaitChannelConfig : undefined
            };
            
            await startComprehensiveWizard(buttonInteraction, client, partialConfigs);
        } else if (buttonInteraction.customId === 'update_staff_role_only') {
            // Quick staff role update
            await buttonInteraction.deferUpdate();
            collector.stop();
            await handleQuickStaffRoleUpdate(buttonInteraction, existingConfigs.existingBotConfig!);
        } else if (buttonInteraction.customId === 'setup_cancel') {
            await handleCancel(buttonInteraction);
            collector.stop();
        }
    });
}

// Quick staff role update (original update mode behavior)
async function handleQuickStaffRoleUpdate(
    interaction: MessageComponentInteraction,
    existingConfig: BotConfig
) {
    const roleEmbed = buildRoleSelectionEmbed();
    const roleSelector = buildRoleSelector();
    const disableButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('disable_staff_role')
            .setLabel('Disable Staff Role')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    await interaction.editReply({
        embeds: [roleEmbed],
        components: [roleSelector, disableButton]
    });

    const reply = await interaction.fetchReply();
    
    // Handle role selection
    const roleCollector = reply.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        time: 180_000
    });

    const buttonCollector = createButtonCollector(reply, 180_000);

    roleCollector.on('collect', async (roleInteraction: RoleSelectMenuInteraction) => {
        const selectedRole = roleInteraction.roles.first();
        
        if (!selectedRole) {
            await roleInteraction.reply({
                embeds: [createErrorEmbed('No role selected. Please try again.')],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (selectedRole.id === roleInteraction.guild?.id) {
            await roleInteraction.reply({
                embeds: [createErrorEmbed('You cannot use @everyone as the staff role!')],
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await roleInteraction.deferUpdate();
        const roleMention = '<@&' + selectedRole.id + '>';
        await updateStaffRole(roleInteraction, existingConfig, true, roleMention);
        roleCollector.stop();
        buttonCollector.stop();
    });

    buttonCollector.on('collect', async (btnInteraction) => {
        if (btnInteraction.customId === 'disable_staff_role') {
            await btnInteraction.deferUpdate();
            await updateStaffRole(btnInteraction, existingConfig, false, null);
            roleCollector.stop();
            buttonCollector.stop();
        }
    });
}

async function updateStaffRole(
    interaction: MessageComponentInteraction,
    existingConfig: BotConfig,
    enabled: boolean,
    role: string | null
) {
    try {
        const botConfigRepository = AppDataSource.getRepository(BotConfig);
        
        existingConfig.enableGlobalStaffRole = enabled;
        existingConfig.globalStaffRole = role;

        await botConfigRepository.save(existingConfig);

        const action = enabled ? 'updated to ' + role : 'disabled';
        await interaction.editReply({
            embeds: [createInfoEmbed('Configuration Updated', 'Global Staff Role has been ' + action + '.')],
            components: []
        });

    } catch (error) {
        console.error(lang.console.errorUpdatingBotConfig, error);
        await interaction.editReply({
            embeds: [createErrorEmbed('Failed to update configuration. Please try again or contact support.')],
            components: []
        });
    }
}

async function handleCancel(interaction: MessageComponentInteraction) {
    await interaction.update({
        embeds: [createInfoEmbed('Setup Cancelled', 'Bot setup has been cancelled. No changes were made. Run /bot-setup again anytime to configure your bot.')],
        components: []
    });
}
