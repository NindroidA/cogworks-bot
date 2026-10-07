import { EmbedBuilder, type Guild, Routes, type TextChannel } from 'discord.js';
import { lang } from '../../lang';
import type { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';
import { Colors } from '../colors';
import { reactionRouteIdentifier } from './optionEmoji';

const tl = lang.reactionRole;

/**
 * Builds the Discord embed for a reaction role menu
 */
export function buildMenuEmbed(menu: ReactionRoleMenu): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`🎭 ${menu.name}`).setColor(Colors.brand.primary);

  if (menu.description) {
    embed.setDescription(menu.description);
  }

  // Build options list
  if (menu.options && menu.options.length > 0) {
    const sorted = [...menu.options].sort((a, b) => a.sortOrder - b.sortOrder);
    const lines = sorted.map(opt => {
      const desc = opt.description ? ` — ${opt.description}` : '';
      return `${opt.emoji} → <@&${opt.roleId}>${desc}`;
    });
    embed.addFields({ name: '\u200b', value: lines.join('\n') });
  } else {
    embed.addFields({ name: '\u200b', value: tl.menu.noOptions });
  }

  // Mode footer
  let modeLabel: string;
  switch (menu.mode) {
    case 'unique':
      modeLabel = tl.menu.modeUnique;
      break;
    case 'lock':
      modeLabel = tl.menu.modeLock;
      break;
    default:
      modeLabel = tl.menu.modeNormal;
  }

  embed.setFooter({ text: `${tl.menu.embedFooter} | Mode: ${modeLabel}` });

  return embed;
}

/**
 * Reactions to change on the menu message. The client's reaction cache is off
 * (`ReactionManager: 0`), so the message can't tell what is already there.
 */
export interface MenuReactionChanges {
  /** Option emoji the bot should react with */
  add?: string[];
  /** Option emoji whose bot reaction should be removed */
  remove?: string[];
}

/**
 * Updates the menu message embed and applies `changes` to the bot's reactions.
 * Without `changes` it reacts with every option again (the dashboard rebuild).
 */
export async function updateMenuMessage(
  menu: ReactionRoleMenu,
  guild: Guild,
  changes?: MenuReactionChanges,
): Promise<boolean> {
  try {
    const channel = await guild.channels.fetch(menu.channelId);
    if (!channel?.isTextBased()) return false;

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(menu.messageId);

    // Update embed
    const embed = buildMenuEmbed(menu);
    await message.edit({ embeds: [embed] });

    const sorted = [...(menu.options || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const emoji of changes ? (changes.add ?? []) : sorted.map(o => o.emoji)) {
      await message.react(emoji);
    }
    for (const emoji of changes?.remove ?? []) {
      await guild.client.rest.delete(
        Routes.channelMessageOwnReaction(menu.channelId, menu.messageId, reactionRouteIdentifier(emoji)),
      );
    }

    return true;
  } catch {
    // Message may have been deleted or channel permissions changed
    return false;
  }
}

/**
 * Validates a role can be used in a reaction role menu
 */
export function validateRoleForMenu(
  role: { id: string; managed: boolean; position: number },
  guild: { id: string },
  botHighestPosition: number,
): { valid: boolean; error?: string } {
  if (role.id === guild.id) {
    return { valid: false, error: tl.add.cannotUseEveryone };
  }

  if (role.managed) {
    return { valid: false, error: tl.add.cannotUseManagedRole };
  }

  if (role.position >= botHighestPosition) {
    return { valid: false, error: tl.add.roleTooHigh };
  }

  return { valid: true };
}
