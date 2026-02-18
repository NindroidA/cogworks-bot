/**
 * Ticket System Step - Bot Setup Wizard
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';

export const ticketStep = {
  buildEmbed: () => {
    return new EmbedBuilder()
      .setTitle('🎫 Ticket System Setup')
      .setDescription(
        '**Would you like to configure the ticket system?**\n\n' +
          'The ticket system allows users to create private support tickets.\n\n' +
          '**This includes:**\n' +
          '• Main ticket channel (where users click to create tickets)\n' +
          '• Ticket category (where active tickets are created)\n' +
          '• Archive forum (where closed tickets are stored)\n\n' +
          '**You can skip this and set it up later with `/ticket-setup`**',
      )
      .setColor('#5865F2');
  },

  buildComponents: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_enable')
          .setLabel('Configure Ticket System')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎫'),
        new ButtonBuilder()
          .setCustomId('ticket_skip')
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
      .setTitle('🎫 Select Ticket Channel')
      .setDescription(
        'Select the text channel where users will create tickets.\n\n' +
          'This channel will have a "Create Ticket" button message.',
      )
      .setColor('#5865F2');
  },

  buildChannelSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`ticket_channel_select_${Date.now()}`)
        .setPlaceholder('Select ticket channel')
        .setChannelTypes(ChannelType.GuildText),
    );
  },

  buildCategorySelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle('📂 Select Ticket Category')
      .setDescription(
        'Select the category where active tickets will be created.\n\n' +
          'Each ticket will be a private channel in this category.',
      )
      .setColor('#5865F2');
  },

  buildCategorySelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`ticket_category_select_${Date.now()}`)
        .setPlaceholder('Select ticket category')
        .setChannelTypes(ChannelType.GuildCategory),
    );
  },

  buildArchiveSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle('🗃️ Select Archive Forum')
      .setDescription(
        'Select the forum channel where closed tickets will be archived.\n\n' +
          'Each closed ticket will create a thread in this forum.',
      )
      .setColor('#5865F2');
  },

  buildArchiveSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`ticket_archive_select_${Date.now()}`)
        .setPlaceholder('Select archive forum')
        .setChannelTypes(ChannelType.GuildForum),
    );
  },
};
