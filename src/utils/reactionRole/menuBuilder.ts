import { EmbedBuilder, type Guild, type TextChannel } from 'discord.js';
import type { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';
import { Colors } from '../colors';
import { lang } from '../index';

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
 * Updates the menu message embed and syncs reactions
 */
export async function updateMenuMessage(menu: ReactionRoleMenu, guild: Guild): Promise<boolean> {
  try {
    const channel = await guild.channels.fetch(menu.channelId);
    if (!channel || !channel.isTextBased()) return false;

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(menu.messageId);

    // Update embed
    const embed = buildMenuEmbed(menu);
    await message.edit({ embeds: [embed] });

    // Sync reactions: add missing
    const sorted = [...(menu.options || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const option of sorted) {
      const existing = message.reactions.cache.find(r => {
        const emojiStr = r.emoji.id ? `<:${r.emoji.name}:${r.emoji.id}>` : r.emoji.name;
        return emojiStr === option.emoji || r.emoji.name === option.emoji;
      });
      if (!existing) {
        await message.react(option.emoji);
      }
    }

    // Remove reactions for removed options
    for (const [, reaction] of message.reactions.cache) {
      const emojiStr = reaction.emoji.id
        ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
        : reaction.emoji.name || '';
      const isBot = reaction.me;
      if (
        isBot &&
        !menu.options?.find(o => o.emoji === emojiStr || o.emoji === reaction.emoji.name)
      ) {
        await reaction.remove();
      }
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
