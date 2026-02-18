/**
 * Application System Step - Bot Setup Wizard
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';

export const applicationStep = {
  buildEmbed: () => {
    return new EmbedBuilder()
      .setTitle('📝 Application System Setup')
      .setDescription(
        '**Would you like to configure the application system?**\n\n' +
          'The application system allows users to apply for positions in your server.\n\n' +
          '**This includes:**\n' +
          '• Main application channel (where users can apply)\n' +
          '• Application category (where active applications are reviewed)\n' +
          '• Archive forum (where closed applications are stored)\n\n' +
          '**You can skip this and set it up later with `/application-setup`**',
      )
      .setColor('#57F287');
  },

  buildComponents: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('application_enable')
          .setLabel('Configure Application System')
          .setStyle(ButtonStyle.Success)
          .setEmoji('📝'),
        new ButtonBuilder()
          .setCustomId('application_skip')
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_cancel')
          .setLabel('Cancel Setup')
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  },

  buildChannelSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle('📝 Select Application Channel')
      .setDescription(
        'Select the text channel where users will submit applications.\n\n' +
          'This channel will have an "Apply" button message.',
      )
      .setColor('#57F287');
  },

  buildChannelSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`application_channel_select_${Date.now()}`)
        .setPlaceholder('Select application channel')
        .setChannelTypes(ChannelType.GuildText),
    );
  },

  buildCategorySelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle('📂 Select Application Category')
      .setDescription(
        'Select the category where active applications will be reviewed.\n\n' +
          'Each application will be a private channel in this category.',
      )
      .setColor('#57F287');
  },

  buildCategorySelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`application_category_select_${Date.now()}`)
        .setPlaceholder('Select application category')
        .setChannelTypes(ChannelType.GuildCategory),
    );
  },

  buildArchiveSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle('🗃️ Select Archive Forum')
      .setDescription(
        'Select the forum channel where closed applications will be archived.\n\n' +
          'Each closed application will create a thread in this forum.',
      )
      .setColor('#57F287');
  },

  buildArchiveSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`application_archive_select_${Date.now()}`)
        .setPlaceholder('Select archive forum')
        .setChannelTypes(ChannelType.GuildForum),
    );
  },
};
