import type { CacheType, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  Colors,
  clampText,
  enhancedLogger,
  fmt,
  guardFeatureRateLimit,
  LogCategory,
  lang,
  replyEphemeralError,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.reactionRole;
const menuRepo = lazyRepo(ReactionRoleMenu);

interface ValidationIssue {
  menu: string;
  issue: string;
}

/**
 * Validates all reaction role menus in the guild.
 * Checks for missing channels, deleted messages, and removed roles.
 */
export async function reactionRoleValidateHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureRateLimit(interaction, 'reactionroles', 'manage', {
    action: 'reactionrole-validate',
    limit: { maxAttempts: 1, windowMs: 300_000 },
    scope: 'guild',
  });
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const menus = await menuRepo.find({
      where: { guildId },
      relations: { options: true },
    });

    if (menus.length === 0) {
      await interaction.editReply({ content: tl.list.empty });
      return;
    }

    const guild = interaction.guild!;
    const issues: ValidationIssue[] = [];
    const validMenus: string[] = [];

    for (const menu of menus) {
      let menuHasIssue = false;

      // Check channel exists
      let channel: TextChannel | null = null;
      try {
        channel = (await guild.channels.fetch(menu.channelId)) as TextChannel;
      } catch {
        // Channel not found
      }

      if (!channel) {
        issues.push({
          menu: menu.name,
          issue: fmt(tl.validate.channelMissing, { name: menu.name, channelId: menu.channelId }),
        });
        menuHasIssue = true;
      } else {
        // Check message exists
        try {
          await channel.messages.fetch(menu.messageId);
        } catch {
          issues.push({
            menu: menu.name,
            issue: fmt(tl.validate.menuMissing, { name: menu.name, channelId: menu.channelId }),
          });
          menuHasIssue = true;
        }
      }

      // Check each option's role exists
      for (const option of menu.options || []) {
        // fetch() returns null for a deleted role; a thrown error (rate limit, 5xx) only means "couldn't check"
        const role = await guild.roles.fetch(option.roleId).catch(() => undefined);
        if (role === null) {
          issues.push({
            menu: menu.name,
            issue: fmt(tl.validate.roleMissing, { name: menu.name, emoji: option.emoji }),
          });
          menuHasIssue = true;
        }
      }

      if (!menuHasIssue) {
        validMenus.push(menu.name);
      }
    }

    // Build report embed
    const embed = new EmbedBuilder().setTitle(tl.validate.title);

    if (issues.length === 0) {
      embed.setColor(Colors.status.success);
      embed.setDescription(tl.validate.allValid);
    } else {
      embed.setColor(Colors.status.warning);
      // The description holds 4096 characters; a field only 1024
      const issueText = issues.map(i => `- ${i.issue}`).join('\n');
      embed.setDescription(
        clampText(`${fmt(tl.validate.issuesFound, { count: issues.length })}\n\n${issueText}`, 4096),
      );
    }

    if (validMenus.length > 0) {
      embed.addFields({
        name: 'Healthy Menus',
        value: clampText(validMenus.map(n => `- **${n}**: All checks passed`).join('\n'), 1024),
      });
    }

    await interaction.editReply({ embeds: [embed] });

    enhancedLogger.info('Reaction role validation completed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      menuCount: menus.length,
      issueCount: issues.length,
    });
  } catch (error) {
    enhancedLogger.error(
      'Reaction role validation failed',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await replyEphemeralError(interaction, tl.validate.error);
  }
}
