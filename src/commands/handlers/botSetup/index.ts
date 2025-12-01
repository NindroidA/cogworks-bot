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
import { createButtonCollector, createErrorEmbed, createInfoEmbed, createRateLimitKey, lang, logger, rateLimiter, RateLimits, requireAdmin } from '../../../utils';
import { startComprehensiveWizard } from './comprehensiveWizard';
import {
    buildRoleSelectionEmbed,
    buildRoleSelector
} from './steps';

export async function botSetupHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({
            embeds: [createErrorEmbed(lang.botSetup.errors.serverOnly)],
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Permission check - admin only
    const permissionCheck = requireAdmin(interaction);
    if (!permissionCheck.allowed) {
        await interaction.reply({
            embeds: [createErrorEmbed(permissionCheck.message || 'Insufficient permissions')],
            flags: [MessageFlags.Ephemeral]
        });
        logger(`Unauthorized bot setup attempt by user ${interaction.user.id} in guild ${interaction.guild.id}`, 'WARN');
        return;
    }

    // Rate limit check (5 bot setups per hour per guild)
    const rateLimitKey = createRateLimitKey.guild(interaction.guild.id, 'bot-setup');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BOT_SETUP);
    
    if (!rateCheck.allowed) {
        const minutes = Math.ceil((rateCheck.resetIn || 0) / 60000);
        await interaction.reply({
            embeds: [createErrorEmbed(
                lang.botSetup.rateLimit.exceeded.replace('{minutes}', minutes.toString())
            )],
            flags: [MessageFlags.Ephemeral]
        });
        logger(lang.botSetup.logs.rateLimit.replace('{guildId}', interaction.guild.id), 'WARN');
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

    statusLines.push(lang.botSetup.update.currentConfig + '\n');
    
    statusLines.push(hasStaffRole 
        ? lang.botSetup.update.staffRoleConfigured.replace('{role}', existingConfigs.existingBotConfig!.globalStaffRole!)
        : lang.botSetup.update.staffRoleNotConfigured);
    
    statusLines.push(hasTicket 
        ? lang.botSetup.update.ticketConfigured
        : lang.botSetup.update.ticketNotConfigured);
    
    statusLines.push(hasApplication 
        ? lang.botSetup.update.applicationConfigured
        : lang.botSetup.update.applicationNotConfigured);
    
    statusLines.push(hasAnnouncement 
        ? lang.botSetup.update.announcementConfigured
        : lang.botSetup.update.announcementNotConfigured);
    
    statusLines.push(hasBaitChannel 
        ? lang.botSetup.update.baitChannelConfigured
        : lang.botSetup.update.baitChannelNotConfigured);

    statusLines.push('\n' + lang.botSetup.update.question);
    
    const updateEmbed = createInfoEmbed(
        lang.botSetup.update.title,
        statusLines.join('\n')
    );

    // Build buttons for each action
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('update_reconfigure_all')
            .setLabel(lang.botSetup.buttons.reconfigureAll)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('update_add_missing')
            .setLabel(lang.botSetup.buttons.addMissing)
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕')
    );

    const moreButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('update_staff_role_only')
            .setLabel(lang.botSetup.buttons.updateStaffRole)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥'),
        new ButtonBuilder()
            .setCustomId('setup_cancel')
            .setLabel(lang.botSetup.buttons.cancel)
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
            .setLabel(lang.botSetup.buttons.disableStaffRole)
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

        const message = enabled 
            ? lang.botSetup.update.staffRoleUpdated.replace('{role}', role!)
            : lang.botSetup.update.staffRoleDisabled;
            
        await interaction.editReply({
            embeds: [createInfoEmbed(lang.botSetup.update.configUpdated, message)],
            components: []
        });

    } catch (error) {
        console.error(lang.console.errorUpdatingBotConfig, error);
        await interaction.editReply({
            embeds: [createErrorEmbed(lang.botSetup.errors.failedToUpdate)],
            components: []
        });
    }
}

async function handleCancel(interaction: MessageComponentInteraction) {
    await interaction.update({
        embeds: [createInfoEmbed(lang.botSetup.cancel.title, lang.botSetup.cancel.message)],
        components: []
    });
}
