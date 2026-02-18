/**
 * Announcement System Step - Bot Setup Wizard
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
} from 'discord.js';

export const announcementStep = {
  buildEmbed: () => {
    return new EmbedBuilder()
      .setTitle('📢 Announcement System Setup')
      .setDescription(
        '**Would you like to configure the announcement system?**\n\n' +
          'The announcement system allows you to send server announcements.\n\n' +
          '**This includes:**\n' +
          '• Minecraft role (for game-specific announcements)\n' +
          '• Default announcement channel\n\n' +
          '**You can skip this and set it up later with `/announcement-setup`**',
      )
      .setColor('#FFA500');
  },

  buildComponents: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('announcement_enable')
          .setLabel('Configure Announcement System')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📢'),
        new ButtonBuilder()
          .setCustomId('announcement_skip')
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_cancel')
          .setLabel('Cancel Setup')
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  },

  buildRoleSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle('🎮 Select Minecraft Role')
      .setDescription(
        'Select the role to use for Minecraft announcements.\n\n' +
          'This role will be mentioned in game-related announcements.',
      )
      .setColor('#FFA500');
  },

  buildRoleSelect: () => {
    return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`announcement_role_select_${Date.now()}`)
        .setPlaceholder('Select Minecraft role'),
    );
  },

  buildChannelSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle('📢 Select Default Announcement Channel')
      .setDescription(
        'Select the default channel for announcements.\n\n' +
          'This channel will be used for general server announcements.',
      )
      .setColor('#FFA500');
  },

  buildChannelSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`announcement_channel_select_${Date.now()}`)
        .setPlaceholder('Select announcement channel')
        .setChannelTypes(ChannelType.GuildText),
    );
  },
};
