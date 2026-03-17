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
import { lang } from '../../../../utils';

const tl = lang.botSetup.ticket;
const btn = lang.botSetup.buttons;

export const ticketStep = {
  buildEmbed: () => {
    return new EmbedBuilder().setTitle(tl.title).setDescription(tl.description).setColor('#5865F2');
  },

  buildComponents: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_enable')
          .setLabel(btn.configureTicket)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎫'),
        new ButtonBuilder()
          .setCustomId('ticket_skip')
          .setLabel(btn.skip)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_cancel')
          .setLabel(btn.cancelSetup)
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  },

  buildChannelSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.channelSelectTitle)
      .setDescription(tl.channelSelectDescription)
      .setColor('#5865F2');
  },

  buildChannelSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`ticket_channel_select_${Date.now()}`)
        .setPlaceholder(tl.channelSelectPlaceholder)
        .setChannelTypes(ChannelType.GuildText),
    );
  },

  buildCategorySelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.categorySelectTitle)
      .setDescription(tl.categorySelectDescription)
      .setColor('#5865F2');
  },

  buildCategorySelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`ticket_category_select_${Date.now()}`)
        .setPlaceholder(tl.categorySelectPlaceholder)
        .setChannelTypes(ChannelType.GuildCategory),
    );
  },

  buildArchiveSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.archiveSelectTitle)
      .setDescription(tl.archiveSelectDescription)
      .setColor('#5865F2');
  },

  buildArchiveSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`ticket_archive_select_${Date.now()}`)
        .setPlaceholder(tl.archiveSelectPlaceholder)
        .setChannelTypes(ChannelType.GuildForum),
    );
  },
};
