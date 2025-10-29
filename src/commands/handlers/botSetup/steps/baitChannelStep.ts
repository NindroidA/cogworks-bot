/**
 * Bait Channel Step Components
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder } from 'discord.js';
import { createInfoEmbed } from '../../../../utils';

export const baitChannelStep = {
    buildEmbed() {
        return createInfoEmbed(
            '🛡️ Bait Channel System',
            '**Anti-Bot Protection**\n\n' +
            'The bait channel system helps protect your server from automated bots by:\n' +
            '• Creating a hidden "bait" channel that legitimate users won\'t see\n' +
            '• Automatically detecting and removing bots that join it\n' +
            '• Providing detailed logs and statistics\n\n' +
            '💡 **How it works:**\n' +
            '1. A hidden channel is created with no permissions for normal users\n' +
            '2. Bots often auto-join all channels they can see\n' +
            '3. When someone joins the bait channel, they\'re flagged as a bot\n' +
            '4. You can choose to kick, ban, or just log the detection\n\n' +
            '⚠️ **Note:** This is an advanced feature. You can always configure it later with `/baitchannel`.\n\n' +
            'Would you like to set up the bait channel system now?'
        );
    },

    buildComponents() {
        return [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('baitchannel_enable')
                    .setLabel('Set Up Bait Channel')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🛡️'),
                new ButtonBuilder()
                    .setCustomId('baitchannel_skip')
                    .setLabel('Skip for Now')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('setup_cancel')
                    .setLabel('Cancel Setup')
                    .setStyle(ButtonStyle.Danger)
            )
        ];
    },

    buildChannelSelectEmbed() {
        return createInfoEmbed(
            '🛡️ Select Bait Channel',
            '**Choose the bait channel for bot detection**\n\n' +
            '📋 **Requirements:**\n' +
            '• Should be a text channel\n' +
            '• Should be hidden from normal users (@everyone should have no access)\n' +
            '• Name it something inconspicuous (e.g., "verify", "rules", "staff")\n\n' +
            '💡 **Tip:** Create a new channel specifically for this purpose with no permissions for @everyone.'
        );
    },

    buildChannelSelect() {
        return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('baitchannel_channel_select_' + Date.now())
                .setPlaceholder('Select the bait channel')
                .addChannelTypes(ChannelType.GuildText)
        );
    },

    buildActionSelectEmbed() {
        return createInfoEmbed(
            '🛡️ Select Action',
            '**What should happen when a bot is detected?**\n\n' +
            '🔨 **Ban** - Permanently removes the bot from your server\n' +
            '👢 **Kick** - Removes the bot (they can rejoin)\n' +
            '📝 **Log Only** - Just records the detection (for testing)\n\n' +
            '💡 **Recommendation:** Start with "Log Only" to test, then switch to "Ban" once confirmed working.'
        );
    },

    buildActionSelect() {
        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('baitchannel_action_select_' + Date.now())
                .setPlaceholder('Select action for detected bots')
                .addOptions([
                    {
                        label: 'Ban',
                        value: 'ban',
                        description: 'Permanently ban detected bots',
                        emoji: '🔨'
                    },
                    {
                        label: 'Kick',
                        value: 'kick',
                        description: 'Kick detected bots (they can rejoin)',
                        emoji: '👢'
                    },
                    {
                        label: 'Log Only (Testing)',
                        value: 'log-only',
                        description: 'Only log detections without taking action',
                        emoji: '📝'
                    }
                ])
        );
    },

    buildGracePeriodEmbed() {
        return createInfoEmbed(
            '🛡️ Grace Period',
            '**Set a grace period before taking action**\n\n' +
            '⏱️ **What is this?**\n' +
            'Time (in seconds) to wait after detection before taking action.\n\n' +
            '💡 **Common settings:**\n' +
            '• **0 seconds** - Instant action (recommended for confirmed bots)\n' +
            '• **5-10 seconds** - Brief window for legitimate users\n' +
            '• **30+ seconds** - Extended grace period\n\n' +
            'Select a grace period below:'
        );
    },

    buildGracePeriodSelect() {
        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('baitchannel_grace_select_' + Date.now())
                .setPlaceholder('Select grace period')
                .addOptions([
                    {
                        label: '0 seconds (Instant)',
                        value: '0',
                        description: 'Take action immediately',
                        emoji: '⚡'
                    },
                    {
                        label: '5 seconds',
                        value: '5',
                        description: 'Short grace period',
                        emoji: '⏱️'
                    },
                    {
                        label: '10 seconds',
                        value: '10',
                        description: 'Medium grace period',
                        emoji: '⏱️'
                    },
                    {
                        label: '30 seconds',
                        value: '30',
                        description: 'Extended grace period',
                        emoji: '⏱️'
                    },
                    {
                        label: '60 seconds',
                        value: '60',
                        description: 'Maximum grace period',
                        emoji: '⏱️'
                    }
                ])
        );
    },

    buildLogChannelSelectEmbed() {
        return createInfoEmbed(
            '🛡️ Log Channel (Optional)',
            '**Choose where to log bot detections**\n\n' +
            '📝 **What gets logged:**\n' +
            '• User who was detected\n' +
            '• Action taken (ban/kick/log)\n' +
            '• Timestamp\n' +
            '• User account age and join date\n\n' +
            '💡 **Tip:** Use a staff-only channel for security logs.\n\n' +
            '⏭️ **Skip this step** if you don\'t want logging.'
        );
    },

    buildLogChannelSelect() {
        return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('baitchannel_log_select_' + Date.now())
                .setPlaceholder('Select log channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
        );
    },

    buildLogChannelSkipButton() {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('baitchannel_log_skip')
                .setLabel('Skip Log Channel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⏭️')
        );
    }
};
