/**
 * Bot Setup Dashboard
 *
 * Renders the persistent setup status embed showing all systems and their
 * configuration state. Provides a select menu to configure individual systems
 * and action buttons for "Finish Later" and "Reset Setup".
 */

import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import type { SetupState, SystemStates, SystemStatus } from '../../../typeorm/entities/SetupState';
import { Colors } from '../../../utils/colors';
import { detectSystemStates } from '../../../utils/setup/systemStates';

// Re-export so existing importers (botSetup/index.ts) keep resolving without
// a churn pass. The single implementation lives in utils/setup/systemStates.
export { detectSystemStates };

/** System metadata for display */
interface SystemInfo {
  id: keyof SystemStates;
  label: string;
  emoji: string;
  description: string;
}

const SYSTEMS: SystemInfo[] = [
  {
    id: 'staffRole',
    label: 'Staff Role',
    emoji: '👥',
    description: 'Global staff role for all systems',
  },
  {
    id: 'ticket',
    label: 'Ticket System',
    emoji: '🎫',
    description: 'Support ticket creation and management',
  },
  {
    id: 'application',
    label: 'Application System',
    emoji: '📋',
    description: 'Staff applications with custom fields',
  },
  {
    id: 'announcement',
    label: 'Announcements',
    emoji: '📢',
    description: 'Templated announcement system',
  },
  {
    id: 'baitchannel',
    label: 'Bait Channel',
    emoji: '🎣',
    description: 'Anti-bot detection channel',
  },
  {
    id: 'memory',
    label: 'Memory System',
    emoji: '🧠',
    description: 'Forum-based bug/feature tracking',
  },
  {
    id: 'rules',
    label: 'Rules Acknowledgment',
    emoji: '📜',
    description: 'React-to-accept rules system',
  },
  {
    id: 'reactionRole',
    label: 'Reaction Roles',
    emoji: '🏷️',
    description: 'Self-assign roles via reactions',
  },
];

const STATUS_ICONS: Record<SystemStatus, string> = {
  not_started: '⚠️',
  partial: '🔧',
  complete: '✅',
};

const STATUS_LABELS: Record<SystemStatus, string> = {
  not_started: 'Not Configured',
  partial: 'In Progress (saved)',
  complete: 'Configured',
};

/**
 * Merge detected DB states with SetupState partial data.
 * If a system has partial data saved but isn't fully configured in DB, show 'partial'.
 */
export function mergeStates(dbStates: SystemStates, setupState: SetupState | null): SystemStates {
  if (!setupState?.partialData) return dbStates;

  const merged = { ...dbStates };
  const partialData = setupState.partialData;

  for (const system of SYSTEMS) {
    const key = system.id;
    if (merged[key] === 'not_started' && partialData[key as keyof typeof partialData]) {
      merged[key] = 'partial';
    }
  }

  return merged;
}

/**
 * Build the setup dashboard embed.
 */
export function buildDashboardEmbed(states: SystemStates, selectedSystems: string[] | null): EmbedBuilder {
  const lines: string[] = [];

  for (const system of SYSTEMS) {
    const status = states[system.id];
    const icon = STATUS_ICONS[status];
    const label = STATUS_LABELS[status];
    const isSelected = !selectedSystems || selectedSystems.includes(system.id);
    const dimmed = selectedSystems && !isSelected;

    if (dimmed) {
      lines.push(`⬛ ${system.emoji} ~~${system.label}~~ — *disabled*`);
    } else {
      lines.push(`${icon} ${system.emoji} **${system.label}** — ${label}`);
    }
  }

  const enabledSystems = selectedSystems ? SYSTEMS.filter(s => selectedSystems.includes(s.id)) : SYSTEMS;
  const completeCount = enabledSystems.filter(s => states[s.id] === 'complete').length;
  const totalEnabled = enabledSystems.length;
  const allDone = totalEnabled > 0 && completeCount === totalEnabled;

  const embed = new EmbedBuilder()
    .setColor(allDone ? Colors.status.success : Colors.status.info)
    .setTitle('Cogworks Setup Dashboard')
    .setDescription(`Configure your server systems below. Select a system to set up or modify.\n\n${lines.join('\n')}`)
    .setFooter({
      text: `${completeCount}/${totalEnabled} systems configured${allDone ? ' — All done!' : ' • Select a system below to configure'}`,
    });

  return embed;
}

/**
 * Build the system selector (StringSelectMenu).
 */
export function buildSystemSelector(
  states: SystemStates,
  selectedSystems: string[] | null,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('setup_system_select')
    .setPlaceholder('Select a system to configure...');

  for (const system of SYSTEMS) {
    const isSelected = !selectedSystems || selectedSystems.includes(system.id);
    if (!isSelected) continue;

    const status = states[system.id];
    const statusLabel = status === 'complete' ? ' ✅' : status === 'partial' ? ' 🔧' : '';

    menu.addOptions({
      label: `${system.label}${statusLabel}`,
      value: system.id,
      description: system.description,
      emoji: system.emoji,
    });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * Get system info by ID.
 */
export function getSystemInfo(systemId: string): SystemInfo | undefined {
  return SYSTEMS.find(s => s.id === systemId);
}

export { SYSTEMS };
