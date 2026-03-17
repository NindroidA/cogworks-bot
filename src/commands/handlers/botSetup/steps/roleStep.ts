/**
 * Role Management Step - Bot Setup Wizard
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { lang } from '../../../../utils';

const tl = lang.botSetup.role;
const btn = lang.botSetup.buttons;

export const roleStep = {
  buildEmbed: () => {
    return new EmbedBuilder().setTitle(tl.title).setDescription(tl.description).setColor('#FEE75C');
  },

  buildComponents: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('role_enable')
          .setLabel(btn.enableRoles)
          .setStyle(ButtonStyle.Success)
          .setEmoji('👥'),
        new ButtonBuilder()
          .setCustomId('role_skip')
          .setLabel(btn.skipRoles)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_cancel')
          .setLabel(btn.cancelSetup)
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  },

  buildRoleTypeEmbed: () => {
    return new EmbedBuilder()
      .setTitle(tl.typeSelectTitle)
      .setDescription(tl.typeSelectDescription)
      .setColor('#FEE75C');
  },

  buildRoleTypeSelect: () => {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('role_type_select')
        .setPlaceholder(tl.typeSelectPlaceholder)
        .addOptions([
          {
            label: tl.staffRoleLabel,
            value: 'staff',
            description: tl.staffRoleDescription,
            emoji: '👔',
          },
          {
            label: tl.adminRoleLabel,
            value: 'admin',
            description: tl.adminRoleDescription,
            emoji: '⭐',
          },
        ]),
    );
  },

  buildRoleSelectEmbed: (roleType: string) => {
    const emoji = roleType === 'staff' ? '👔' : '⭐';
    const typeName = roleType === 'staff' ? 'Staff' : 'Admin';

    return new EmbedBuilder()
      .setTitle(tl.selectTitle.replace('{roleType}', `${emoji} ${typeName}`))
      .setDescription(tl.selectDescription)
      .setColor('#FEE75C');
  },

  buildRoleSelect: () => {
    return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`role_select_${Date.now()}`)
        .setPlaceholder(tl.selectPlaceholder.replace('{roleType}', '')),
    );
  },

  buildAddMoreEmbed: (addedRoles: Array<{ type: string; role: string; alias?: string }>) => {
    let description = `**${tl.rolesSoFar}**\n\n`;

    const staffRoles = addedRoles.filter(r => r.type === 'staff');
    const adminRoles = addedRoles.filter(r => r.type === 'admin');

    if (staffRoles.length > 0) {
      description += `**👔 ${tl.staffRolesHeader}**\n`;
      for (const r of staffRoles) {
        description += `• ${r.role}${r.alias ? ` (${r.alias})` : ''}\n`;
      }
      description += '\n';
    }

    if (adminRoles.length > 0) {
      description += `**⭐ ${tl.adminRolesHeader}**\n`;
      for (const r of adminRoles) {
        description += `• ${r.role}${r.alias ? ` (${r.alias})` : ''}\n`;
      }
      description += '\n';
    }

    description += tl.addMoreQuestion;

    return new EmbedBuilder()
      .setTitle(tl.addMoreTitle)
      .setDescription(description)
      .setColor('#FEE75C');
  },

  buildAddMoreButtons: () => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('role_add_more')
          .setLabel(btn.addMoreRoles)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('➕'),
        new ButtonBuilder()
          .setCustomId('role_done')
          .setLabel(btn.doneAddingRoles)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('setup_cancel')
          .setLabel(btn.cancelSetup)
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  },
};
