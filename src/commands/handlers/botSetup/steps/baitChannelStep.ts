/**
 * Bait Channel Step Components
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
} from 'discord.js';
import { createInfoEmbed, lang } from '../../../../utils';

const tl = lang.botSetup.baitChannel;
const btn = lang.botSetup.buttons;

export const baitChannelStep = {
  buildEmbed() {
    return createInfoEmbed(tl.title, tl.description);
  },

  buildComponents() {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('baitchannel_enable')
          .setLabel(btn.configureBaitChannel)
          .setStyle(ButtonStyle.Success)
          .setEmoji('🛡️'),
        new ButtonBuilder()
          .setCustomId('baitchannel_skip')
          .setLabel(btn.skip)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_cancel')
          .setLabel(btn.cancelSetup)
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  },

  buildChannelSelectEmbed() {
    return createInfoEmbed(tl.channelSelectTitle, tl.channelSelectDescription);
  },

  buildChannelSelect() {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`baitchannel_channel_select_${Date.now()}`)
        .setPlaceholder(tl.channelSelectPlaceholder)
        .addChannelTypes(ChannelType.GuildText),
    );
  },

  buildActionSelectEmbed() {
    return createInfoEmbed(tl.actionSelectTitle, tl.actionSelectDescription);
  },

  buildActionSelect() {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`baitchannel_action_select_${Date.now()}`)
        .setPlaceholder(tl.actionSelectPlaceholder)
        .addOptions([
          {
            label: tl.actionBan,
            value: 'ban',
            description: tl.actionBanDescription,
            emoji: '🔨',
          },
          {
            label: tl.actionKick,
            value: 'kick',
            description: tl.actionKickDescription,
            emoji: '👢',
          },
          {
            label: tl.actionLogOnly,
            value: 'log-only',
            description: tl.actionLogOnlyDescription,
            emoji: '📝',
          },
        ]),
    );
  },

  buildGracePeriodEmbed() {
    return createInfoEmbed(tl.gracePeriodTitle, tl.gracePeriodDescription);
  },

  buildGracePeriodSelect() {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`baitchannel_grace_select_${Date.now()}`)
        .setPlaceholder(tl.gracePeriodPlaceholder)
        .addOptions([
          {
            label: tl.graceInstant,
            value: '0',
            description: tl.graceInstantDescription,
            emoji: '⚡',
          },
          { label: tl.grace5, value: '5', description: tl.grace5Description, emoji: '⏱️' },
          { label: tl.grace10, value: '10', description: tl.grace10Description, emoji: '⏱️' },
          { label: tl.grace30, value: '30', description: tl.grace30Description, emoji: '⏱️' },
          { label: tl.grace60, value: '60', description: tl.grace60Description, emoji: '⏱️' },
        ]),
    );
  },

  buildLogChannelSelectEmbed() {
    return createInfoEmbed(tl.logChannelTitle, tl.logChannelDescription);
  },

  buildLogChannelSelect() {
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`baitchannel_log_select_${Date.now()}`)
        .setPlaceholder(tl.logChannelPlaceholder)
        .addChannelTypes(ChannelType.GuildText),
    );
  },

  buildLogChannelSkipButton() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('baitchannel_log_skip')
        .setLabel(tl.logSkipButton)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️'),
    );
  },
};
