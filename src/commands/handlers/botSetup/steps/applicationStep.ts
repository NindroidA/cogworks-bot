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
import { lang } from '../../../../utils';

const tl = lang.botSetup.application;
const btn = lang.botSetup.buttons;

export const applicationStep = {
  buildEmbed: () => {
    return new EmbedBuilder().setTitle(tl.title).setDescription(tl.description).setColor('#57F287');
  },

  buildComponents: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('application_enable')
          .setLabel(btn.configureApplication)
          .setStyle(ButtonStyle.Success)
          .setEmoji('📝'),
        new ButtonBuilder()
          .setCustomId('application_skip')
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
      .setColor('#57F287');
  },

  buildChannelSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`application_channel_select_${Date.now()}`)
        .setPlaceholder(tl.channelSelectPlaceholder)
        .setChannelTypes(ChannelType.GuildText),
    );
  },

  buildCategorySelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.categorySelectTitle)
      .setDescription(tl.categorySelectDescription)
      .setColor('#57F287');
  },

  buildCategorySelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`application_category_select_${Date.now()}`)
        .setPlaceholder(tl.categorySelectPlaceholder)
        .setChannelTypes(ChannelType.GuildCategory),
    );
  },

  buildArchiveSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.archiveSelectTitle)
      .setDescription(tl.archiveSelectDescription)
      .setColor('#57F287');
  },

  buildArchiveSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`application_archive_select_${Date.now()}`)
        .setPlaceholder(tl.archiveSelectPlaceholder)
        .setChannelTypes(ChannelType.GuildForum),
    );
  },
};
