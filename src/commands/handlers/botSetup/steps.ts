/**
 * Bot Setup Wizard - Configuration Steps
 * 
 * This module defines all setup steps in a modular, extensible way.
 * Each step is self-contained with its own UI, validation, and save logic.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder } from 'discord.js';
import type { BotConfig } from '../../../typeorm/entities/BotConfig';
import { createInfoEmbed, createSuccessEmbed } from '../../../utils';

// Export new step modules
export { announcementStep } from './steps/announcementStep';
export { applicationStep } from './steps/applicationStep';
export { baitChannelStep } from './steps/baitChannelStep';
export { roleStep } from './steps/roleStep';
export { ticketStep } from './steps/ticketStep';

/**
 * Setup step interface - all steps must implement this
 */
export interface SetupStep {
    id: string;
    title: string;
    description: string;
    buildEmbed: () => ReturnType<typeof createInfoEmbed>;
    buildComponents: () => ActionRowBuilder<ButtonBuilder>[];
    isOptional?: boolean;
}

/**
 * Step 1: Welcome & Overview
 */
export const welcomeStep: SetupStep = {
    id: 'welcome',
    title: '🎉 Welcome to Cogworks Bot Setup',
    description: 'Let\'s configure your bot step by step',
    buildEmbed: () => {
        const embed = createInfoEmbed(
            '🎉 Welcome to Cogworks Bot Setup',
            '**Thank you for choosing Cogworks Bot!**\n\n' +
            'This wizard will guide you through the complete setup process.\n\n' +
            '📋 **What we\'ll configure:**\n' +
            '• Global Staff Role (optional)\n' +
            '• Ticket System (optional)\n' +
            '• Application System (optional)\n' +
            '• Staff & Admin Roles (optional)\n\n' +
            '⏱️ **Estimated time:** 5-10 minutes\n' +
            '💡 **Tip:** You can skip any optional steps and configure them later!'
        );
        embed.addFields({
            name: '📍 Getting Started',
            value: 'Click **Start Setup** to begin configuring your bot!',
            inline: false
        });
        return embed;
    },
    buildComponents: () => {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('setup_start')
                .setLabel('Start Setup')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🚀'),
            new ButtonBuilder()
                .setCustomId('setup_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('❌')
        );
        return [row];
    }
};

/**
 * Step 2: Global Staff Role Configuration
 */
export const staffRoleStep: SetupStep = {
    id: 'staff_role',
    title: '👥 Global Staff Role',
    description: 'Configure staff permissions',
    isOptional: true,
    buildEmbed: () => {
        const embed = createInfoEmbed(
            '👥 Global Staff Role Configuration',
            '**What is a Global Staff Role?**\n' +
            'This role grants members access to:\n' +
            '• View and respond to all tickets\n' +
            '• Manage bot configurations\n' +
            '• Access administrative features\n\n' +
            '**Important Notes:**\n' +
            '⚠️ This is optional - you can skip this step\n' +
            '✅ You can change this role later\n' +
            '📝 Multiple staff/admin roles can be added separately'
        );
        embed.addFields({
            name: '📍 Step 2 of 3',
            value: 'Would you like to enable a Global Staff Role?',
            inline: false
        });
        return embed;
    },
    buildComponents: () => {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('staff_role_enable')
                .setLabel('Enable & Select Role')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId('staff_role_skip')
                .setLabel('Skip (No Staff Role)')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⏭️')
        );
        return [row];
    }
};

/**
 * Step 2b: Role Selection (if enabled)
 */
export function buildRoleSelectionEmbed() {
    const embed = createInfoEmbed(
        '🔍 Select Staff Role',
        '**Please select the role from the dropdown below:**\n\n' +
        '💡 **Tip:** Choose a role that your staff members already have.\n' +
        '⚠️ Make sure the role exists and is not @everyone'
    );
    embed.addFields({
        name: '📍 Step 2 of 3',
        value: 'Select a role from the menu below',
        inline: false
    });
    return embed;
}

export function buildRoleSelector() {
    return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('staff_role_select_' + Date.now())
            .setPlaceholder('🔍 Choose a staff role...')
            .setMinValues(1)
            .setMaxValues(1)
    );
}

/**
 * Step 3: Configuration Summary & Confirmation
 */
export function buildSummaryEmbed(config: Partial<BotConfig>) {
    const embed = createInfoEmbed(
        '📋 Configuration Summary',
        '**Please review your bot configuration:**\n\n' +
        'Here\'s what will be saved:'
    );

    // Add configuration fields
    if (config.enableGlobalStaffRole && config.globalStaffRole) {
        embed.addFields({
            name: '👥 Global Staff Role',
            value: `✅ Enabled\n**Role:** ${config.globalStaffRole}`,
            inline: false
        });
    } else {
        embed.addFields({
            name: '👥 Global Staff Role',
            value: '❌ Disabled (can be enabled later)',
            inline: false
        });
    }

    embed.addFields({
        name: '📍 Step 3 of 3',
        value: 'Click **Confirm & Save** to apply these settings',
        inline: false
    });

    embed.setFooter({ text: '💡 You can modify these settings anytime with /bot-setup' });

    return embed;
}

export function buildSummaryButtons() {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('setup_confirm')
            .setLabel('Confirm & Save')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId('setup_restart')
            .setLabel('Start Over')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('setup_cancel')
            .setLabel('Cancel Setup')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );
    return [row];
}

/**
 * Final Success Step
 */
export function buildSuccessEmbed(config: Partial<BotConfig>, additionalSystems?: {
    ticketConfigured?: boolean;
    applicationConfigured?: boolean;
    announcementConfigured?: boolean;
    baitChannelConfigured?: boolean;
    rolesAdded?: number;
}) {
    const embed = createSuccessEmbed(
        '✅ Setup Complete!',
        '**Your bot has been configured successfully!**\n\n' +
        'The following settings have been saved:'
    );

    if (config.enableGlobalStaffRole && config.globalStaffRole) {
        embed.addFields({
            name: '👥 Global Staff Role',
            value: `${config.globalStaffRole}`,
            inline: false
        });
    }

    if (additionalSystems) {
        let systemsSummary = '';
        
        if (additionalSystems.ticketConfigured) {
            systemsSummary += '✅ Ticket System Configured\n';
        }
        
        if (additionalSystems.applicationConfigured) {
            systemsSummary += '✅ Application System Configured\n';
        }
        
        if (additionalSystems.announcementConfigured) {
            systemsSummary += '✅ Announcement System Configured\n';
        }
        
        if (additionalSystems.baitChannelConfigured) {
            systemsSummary += '✅ Bait Channel (Anti-Bot) Configured\n';
        }
        
        if (additionalSystems.rolesAdded && additionalSystems.rolesAdded > 0) {
            systemsSummary += `✅ ${additionalSystems.rolesAdded} Role(s) Added\n`;
        }
        
        if (systemsSummary) {
            embed.addFields({
                name: '🎯 Systems Configured',
                value: systemsSummary,
                inline: false
            });
        }
    }

    embed.addFields({
        name: '🚀 What\'s Next?',
        value: '• Start using your configured systems\n' +
               '• Customize further with individual commands\n' +
               '• Run `/bot-setup` again anytime to update settings',
        inline: false
    });

    embed.setFooter({ text: '💡 Need help? Check our documentation or contact support' });

    return embed;
}

/**
 * Update mode: Show current config and options
 */
export function buildUpdateEmbed(config: BotConfig) {
    const embed = createInfoEmbed(
        '🔧 Update Bot Configuration',
        '**Your current configuration:**\n\n' +
        'What would you like to modify?'
    );

    if (config.enableGlobalStaffRole && config.globalStaffRole) {
        embed.addFields({
            name: '👥 Current Staff Role',
            value: `${config.globalStaffRole}\n✅ Enabled`,
            inline: false
        });
    } else {
        embed.addFields({
            name: '👥 Current Staff Role',
            value: '❌ Not configured',
            inline: false
        });
    }

    embed.setFooter({ text: '💡 Select an option below to reconfigure' });

    return embed;
}

export function buildUpdateButtons() {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('update_staff_role')
            .setLabel('Change Staff Role')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('👥'),
        new ButtonBuilder()
            .setCustomId('update_disable_staff')
            .setLabel('Disable Staff Role')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌'),
        new ButtonBuilder()
            .setCustomId('setup_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );
    return [row];
}
