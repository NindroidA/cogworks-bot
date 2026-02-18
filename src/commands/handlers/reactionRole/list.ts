import {
  type CacheType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import { Colors, enhancedLogger, LogCategory, lang, requireAdmin } from '../../../utils';

const tl = lang.reactionRole;
const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

export async function reactionRoleListHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId || '';

  try {
    const menus = await menuRepo.find({
      where: { guildId },
      relations: ['options'],
    });

    if (menus.length === 0) {
      await interaction.reply({
        content: tl.list.empty,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(tl.list.title)
      .setColor(Colors.brand.primary)
      .setTimestamp();

    for (const menu of menus) {
      const sorted = [...menu.options].sort((a, b) => a.sortOrder - b.sortOrder);
      const optionLines = sorted.map(opt => {
        // Check if role still exists
        const roleExists = interaction.guild?.roles.cache.has(opt.roleId);
        const roleDisplay = roleExists
          ? `<@&${opt.roleId}>`
          : `${opt.roleId} ${tl.list.roleDeletedWarning}`;
        return `${opt.emoji} → ${roleDisplay}`;
      });

      const modeLabel =
        menu.mode === 'unique' ? 'Unique' : menu.mode === 'lock' ? 'Lock' : 'Normal';
      const value = optionLines.length > 0 ? optionLines.join('\n') : '_No options_';

      embed.addFields({
        name: `${menu.name} (ID: ${menu.id}) — ${modeLabel}`,
        value: `${tl.list.channelLabel}: <#${menu.channelId}>\n${value}`,
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    enhancedLogger.error(
      'Failed to list reaction role menus',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.list.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
