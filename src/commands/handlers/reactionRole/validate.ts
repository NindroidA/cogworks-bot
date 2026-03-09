import type { CacheType, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  Colors,
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  rateLimiter,
  requireAdmin,
} from '../../../utils';

const tl = lang.reactionRole;
const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

interface ValidationIssue {
  menu: string;
  issue: string;
}

/**
 * Validates all reaction role menus in the guild.
 * Checks for missing channels, deleted messages, and removed roles.
 */
export async function reactionRoleValidateHandler(
  interaction: ChatInputCommandInteraction<CacheType>,
) {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId || '';

  // Rate limit: 1 per 5 minutes per guild
  const rateLimitKey = createRateLimitKey.guild(guildId, 'reactionrole-validate');
  const rateCheck = rateLimiter.check(rateLimitKey, {
    maxAttempts: 1,
    windowMs: 300_000,
  });
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: rateCheck.message!,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const menus = await menuRepo.find({
      where: { guildId },
      relations: ['options'],
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
          issue: tl.validate.channelMissing
            .replace('{name}', menu.name)
            .replace('{channelId}', menu.channelId),
        });
        menuHasIssue = true;
      } else {
        // Check message exists
        try {
          await channel.messages.fetch(menu.messageId);
        } catch {
          issues.push({
            menu: menu.name,
            issue: tl.validate.menuMissing
              .replace('{name}', menu.name)
              .replace('{channelId}', menu.channelId),
          });
          menuHasIssue = true;
        }
      }

      // Check each option's role exists
      for (const option of menu.options || []) {
        try {
          await guild.roles.fetch(option.roleId);
        } catch {
          issues.push({
            menu: menu.name,
            issue: tl.validate.roleMissing
              .replace('{name}', menu.name)
              .replace('{emoji}', option.emoji),
          });
          menuHasIssue = true;
        }
      }

      if (!menuHasIssue) {
        validMenus.push(menu.name);
      }
    }

    // Build report embed
    const embed = new EmbedBuilder().setTitle(tl.validate.title).setTimestamp();

    if (issues.length === 0) {
      embed.setColor(Colors.status.success);
      embed.setDescription(tl.validate.allValid);
    } else {
      embed.setColor(Colors.status.warning);
      embed.setDescription(LANGF(tl.validate.issuesFound, issues.length.toString()));

      // Group issues (truncate if too many)
      const issueText = issues
        .map(i => `- ${i.issue}`)
        .join('\n')
        .slice(0, 4000);
      embed.addFields({ name: 'Issues', value: issueText });
    }

    if (validMenus.length > 0) {
      embed.addFields({
        name: 'Healthy Menus',
        value: validMenus
          .map(n => `- **${n}**: All checks passed`)
          .join('\n')
          .slice(0, 1024),
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
    await interaction.editReply({ content: tl.validate.error });
  }
}
