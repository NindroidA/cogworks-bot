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
import { lang } from '../../../../utils';

const tl = lang.botSetup.announcement;
const btn = lang.botSetup.buttons;

export const announcementStep = {
  buildEmbed: () => {
    return new EmbedBuilder().setTitle(tl.title).setDescription(tl.description).setColor('#FFA500');
  },

  buildComponents: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('announcement_enable')
          .setLabel(btn.configureAnnouncement)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📢'),
        new ButtonBuilder()
          .setCustomId('announcement_skip')
          .setLabel(btn.skip)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_cancel')
          .setLabel(btn.cancelSetup)
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  },

  buildRoleSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.roleSelectTitle)
      .setDescription(tl.roleSelectDescription)
      .setColor('#FFA500');
  },

  buildRoleSelect: () => {
    return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`announcement_role_select_${Date.now()}`)
        .setPlaceholder(tl.roleSelectPlaceholder),
    );
  },

  buildChannelSelectEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.channelSelectTitle)
      .setDescription(tl.channelSelectDescription)
      .setColor('#FFA500');
  },

  buildChannelSelect: () => {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`announcement_channel_select_${Date.now()}`)
        .setPlaceholder(tl.channelSelectPlaceholder)
        .setChannelTypes(ChannelType.GuildText),
    );
  },
};
