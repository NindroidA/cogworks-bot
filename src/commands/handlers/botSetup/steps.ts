/**
 * Bot Setup Wizard - Configuration Steps
 *
 * This module defines all setup steps in a modular, extensible way.
 * Each step is self-contained with its own UI, validation, and save logic.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder } from 'discord.js';
import type { BotConfig } from '../../../typeorm/entities/BotConfig';
import { createInfoEmbed, createSuccessEmbed, lang } from '../../../utils';

// Export new step modules
export { announcementStep } from './steps/announcementStep';
export { applicationStep } from './steps/applicationStep';
export { baitChannelStep } from './steps/baitChannelStep';
export { roleStep } from './steps/roleStep';
export { ticketStep } from './steps/ticketStep';

/**
 * Setup step interface - all steps must implement this
 */
interface SetupStep {
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
  title: lang.botSetup.welcome.title,
  description: lang.botSetup.welcome.description,
  buildEmbed: () => {
    const embed = createInfoEmbed(lang.botSetup.welcome.title, lang.botSetup.welcome.description);
    embed.addFields({
      name: lang.botSetup.welcome.gettingStarted,
      value: lang.botSetup.welcome.clickToStart,
      inline: false,
    });
    return embed;
  },
  buildComponents: () => {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_start')
        .setLabel(lang.botSetup.buttons.startSetup)
        .setStyle(ButtonStyle.Success)
        .setEmoji('🚀'),
      new ButtonBuilder()
        .setCustomId('setup_cancel')
        .setLabel(lang.botSetup.buttons.cancel)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌'),
    );
    return [row];
  },
};

/**
 * Step 2: Global Staff Role Configuration
 */
export const staffRoleStep: SetupStep = {
  id: 'staff_role',
  title: lang.botSetup.staffRole.title,
  description: lang.botSetup.staffRole.description,
  isOptional: true,
  buildEmbed: () => {
    const embed = createInfoEmbed(
      lang.botSetup.staffRole.title,
      lang.botSetup.staffRole.description,
    );
    embed.addFields({
      name: lang.botSetup.staffRole.step,
      value: lang.botSetup.staffRole.question,
      inline: false,
    });
    return embed;
  },
  buildComponents: () => {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('staff_role_enable')
        .setLabel(lang.botSetup.buttons.enableStaffRole)
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId('staff_role_skip')
        .setLabel(lang.botSetup.buttons.skipStaffRole)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️'),
    );
    return [row];
  },
};

/**
 * Step 2b: Role Selection (if enabled)
 */
export function buildRoleSelectionEmbed() {
  const embed = createInfoEmbed(
    lang.botSetup.staffRole.selectTitle,
    lang.botSetup.staffRole.selectDescription,
  );
  embed.addFields({
    name: lang.botSetup.staffRole.step,
    value: lang.botSetup.staffRole.selectStep,
    inline: false,
  });
  return embed;
}

export function buildRoleSelector() {
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`staff_role_select_${Date.now()}`)
      .setPlaceholder(lang.botSetup.staffRole.selectPlaceholder)
      .setMinValues(1)
      .setMaxValues(1),
  );
}

/**
 * Final Success Step
 */
export function buildSuccessEmbed(
  config: Partial<BotConfig>,
  additionalSystems?: {
    ticketConfigured?: boolean;
    applicationConfigured?: boolean;
    announcementConfigured?: boolean;
    baitChannelConfigured?: boolean;
    rolesAdded?: number;
  },
) {
  const sm = lang.botSetup.summary;
  const embed = createSuccessEmbed(`✅ ${sm.title}`, `**${sm.description}**`);

  if (config.enableGlobalStaffRole && config.globalStaffRole) {
    embed.addFields({
      name: `👥 ${sm.globalStaffRole}`,
      value: `${config.globalStaffRole}`,
      inline: false,
    });
  }

  if (additionalSystems) {
    let systemsSummary = '';

    if (additionalSystems.ticketConfigured) {
      systemsSummary += `✅ ${sm.ticketSystem}\n`;
    }
    if (additionalSystems.applicationConfigured) {
      systemsSummary += `✅ ${sm.applicationSystem}\n`;
    }
    if (additionalSystems.announcementConfigured) {
      systemsSummary += `✅ ${sm.announcementSystem}\n`;
    }
    if (additionalSystems.baitChannelConfigured) {
      systemsSummary += `✅ ${sm.baitChannelSystem}\n`;
    }
    if (additionalSystems.rolesAdded && additionalSystems.rolesAdded > 0) {
      systemsSummary += `✅ ${sm.rolesAdded.replace('{count}', additionalSystems.rolesAdded.toString())}\n`;
    }

    if (systemsSummary) {
      embed.addFields({
        name: `🎯 ${sm.systemsConfigured}`,
        value: systemsSummary,
        inline: false,
      });
    }
  }

  embed.addFields({
    name: `🚀 ${sm.whatsNext}`,
    value: sm.whatsNextValue,
    inline: false,
  });

  embed.setFooter({ text: `💡 ${sm.footer}` });

  return embed;
}

/**
 * Update mode: Show current config and options
 */
export function buildUpdateEmbed(config: BotConfig) {
  const up = lang.botSetup.update;
  const embed = createInfoEmbed(up.title, `${up.currentConfig}\n\n${up.question}`);

  if (config.enableGlobalStaffRole && config.globalStaffRole) {
    embed.addFields({
      name: up.staffRoleConfigured.replace('{role}', ''),
      value: `${config.globalStaffRole}\n✅`,
      inline: false,
    });
  } else {
    embed.addFields({
      name: up.staffRoleNotConfigured,
      value: '❌',
      inline: false,
    });
  }

  return embed;
}
