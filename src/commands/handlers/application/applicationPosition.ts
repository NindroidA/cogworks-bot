import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import {
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';
import { getTemplate } from './applicationTemplates';

const positionRepo = AppDataSource.getRepository(Position);
const pl = lang.application.position;

export const applicationPositionHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const subCommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId || '';

  // Permission check - admin only
  const permissionCheck = requireAdmin(interaction);
  if (!permissionCheck.allowed) {
    await interaction.reply({
      content: permissionCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.warn(
      `Unauthorized application position operation attempt by user ${interaction.user.id} in guild ${guildId}`,
      LogCategory.SECURITY,
      { userId: interaction.user.id, guildId },
    );
    return;
  }

  // Rate limit check (15 position operations per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'application-position');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.APPLICATION_POSITION);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.warn(
      `Rate limit exceeded for application position in guild ${guildId}`,
      LogCategory.SECURITY,
      {
        guildId,
      },
    );
    return;
  }

  if (subCommand === 'add') {
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const template = interaction.options.getString('template');
    const emoji = interaction.options.getString('emoji');

    let finalTitle: string;
    let finalDescription: string;
    let finalEmoji: string | null = emoji || null;
    let finalCustomFields: Position['customFields'] = null;
    let finalAgeGate = false;

    // if template is provided, use that instead of title/description
    if (template) {
      const templateData = getTemplate(template);
      if (!templateData) {
        await interaction.reply({
          content: pl.templateNotFound,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      finalTitle = title || templateData.title;
      finalDescription = description || templateData.description;
      finalEmoji = emoji || templateData.emoji;
      finalCustomFields = templateData.customFields;
      finalAgeGate = templateData.ageGateEnabled;
    } else {
      // use provided title and description
      if (!title || !description) {
        await interaction.reply({
          content: pl.provideEither,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      finalTitle = title;
      finalDescription = description;
    }

    try {
      // get the highest display order and increment
      const maxOrder = await positionRepo
        .createQueryBuilder('position')
        .select('MAX(position.displayOrder)', 'maxOrder')
        .where('position.guildId = :guildId', { guildId })
        .getRawOne();

      const newPosition = positionRepo.create({
        guildId,
        title: finalTitle,
        description: finalDescription,
        emoji: finalEmoji,
        customFields: finalCustomFields,
        ageGateEnabled: finalAgeGate,
        displayOrder: (maxOrder?.maxOrder || 0) + 1,
      });

      await positionRepo.save(newPosition);

      const fieldCount = finalCustomFields?.length || 0;
      await interaction.reply({
        content: `✅ Position "${finalTitle}" added successfully! (ID: ${newPosition.id})${template ? `\n📋 Template applied with ${fieldCount} custom field(s).` : ''}${pl.addedInactive}`,
        flags: [MessageFlags.Ephemeral],
      });

      enhancedLogger.info(
        `Position added: "${finalTitle}" (ID: ${newPosition.id})`,
        LogCategory.COMMAND_EXECUTION,
        {
          userId: interaction.user.id,
          guildId,
          positionId: newPosition.id,
          template: template || 'custom',
        },
      );

      // update the application channel message
      await updateApplicationMessage(interaction.client, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to add position',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await interaction.reply({
        content: pl.failAdd,
        flags: [MessageFlags.Ephemeral],
      });
    }
  } else if (subCommand === 'remove') {
    const positionValue = interaction.options.getString('position', true);
    const positionId = parseInt(positionValue, 10);

    try {
      const position = await positionRepo.findOne({
        where: { id: positionId, guildId },
      });

      if (!position) {
        await interaction.reply({
          content: pl.notFound,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      await positionRepo.remove(position);

      // Auto-reindex remaining positions to fill gaps
      const remaining = await positionRepo.find({
        where: { guildId },
        order: { displayOrder: 'ASC', id: 'ASC' },
      });
      for (let i = 0; i < remaining.length; i++) {
        remaining[i].displayOrder = i + 1;
      }
      if (remaining.length > 0) {
        await positionRepo.save(remaining);
      }

      await interaction.reply({
        content: `✅ Position "${position.title}" removed successfully!`,
        flags: [MessageFlags.Ephemeral],
      });

      enhancedLogger.info(`Position removed: "${position.title}"`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        positionId,
      });

      // update the application channel message
      await updateApplicationMessage(interaction.client, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to remove position',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await interaction.reply({
        content: pl.failRemove,
        flags: [MessageFlags.Ephemeral],
      });
    }
  } else if (subCommand === 'toggle') {
    const positionValue = interaction.options.getString('position', true);
    const positionId = parseInt(positionValue, 10);

    try {
      const position = await positionRepo.findOne({
        where: { id: positionId, guildId },
      });

      if (!position) {
        await interaction.reply({
          content: pl.notFound,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      position.isActive = !position.isActive;
      await positionRepo.save(position);

      await interaction.reply({
        content: `✅ Position "${position.title}" is now ${position.isActive ? 'active' : 'inactive'}.`,
        flags: [MessageFlags.Ephemeral],
      });

      enhancedLogger.info(
        `Position toggled: "${position.title}" -> ${position.isActive ? 'active' : 'inactive'}`,
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId, positionId },
      );

      // update the application channel message
      await updateApplicationMessage(interaction.client, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to toggle position',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await interaction.reply({
        content: pl.failToggle,
        flags: [MessageFlags.Ephemeral],
      });
    }
  } else if (subCommand === 'list') {
    try {
      const positions = await positionRepo.find({
        where: { guildId },
        order: { displayOrder: 'ASC' },
      });

      if (positions.length === 0) {
        await interaction.reply({
          content: pl.noneFound,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const positionList = positions
        .map(pos => {
          const emoji = pos.emoji || '📝';
          const status = pos.isActive ? '✅' : '❌';
          const fieldCount = pos.customFields?.length || 0;
          const ageGate = pos.ageGateEnabled ? '🔞' : '';
          return `**#${pos.displayOrder}** (ID: ${pos.id}) - ${emoji} ${pos.title} ${status} ${ageGate}\n${pos.description.substring(0, 100)}${pos.description.length > 100 ? '...' : ''}\n📋 ${fieldCount} field(s)`;
        })
        .join('\n\n');

      await interaction.reply({
        content: `📋 **Positions:**\n\n${positionList}`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (error) {
      enhancedLogger.error(
        'Failed to list positions',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await interaction.reply({
        content: pl.failList,
        flags: [MessageFlags.Ephemeral],
      });
    }
  } else if (subCommand === 'refresh') {
    try {
      await updateApplicationMessage(interaction.client, guildId);

      await interaction.reply({
        content: pl.successRefresh,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (error) {
      enhancedLogger.error(
        'Failed to refresh application message',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await interaction.reply({
        content: pl.failRefresh,
        flags: [MessageFlags.Ephemeral],
      });
    }
  } else if (subCommand === 'reindex') {
    try {
      const positions = await positionRepo.find({
        where: { guildId },
        order: { displayOrder: 'ASC', id: 'ASC' },
      });

      if (positions.length === 0) {
        await interaction.reply({
          content: pl.noneFound,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Reassign displayOrder sequentially: 1, 2, 3, ...
      for (let i = 0; i < positions.length; i++) {
        positions[i].displayOrder = i + 1;
      }
      await positionRepo.save(positions);

      await interaction.reply({
        content: `✅ ${pl.reindex}`,
        flags: [MessageFlags.Ephemeral],
      });

      enhancedLogger.info(
        `Positions reindexed: ${positions.length} positions`,
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );

      // Update the application channel message
      await updateApplicationMessage(interaction.client, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to reindex positions',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await interaction.reply({
        content: pl.failReindex,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
};

// function to update the application message with current positions
export async function updateApplicationMessage(client: Client, guildId: string) {
  try {
    const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
    const applicationConfig = await applicationConfigRepo.findOneBy({
      guildId,
    });

    if (!applicationConfig) return;

    const channel = await client.channels.fetch(applicationConfig.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(applicationConfig.messageId);
    if (!message) return;

    // get active positions
    const activePositions = await positionRepo.find({
      where: { guildId, isActive: true },
      order: { displayOrder: 'ASC' },
    });

    // build the message content and components
    const { content, components } = await buildApplicationMessage(activePositions);

    await message.edit({
      content,
      components,
    });
  } catch (error) {
    enhancedLogger.error(
      'Failed to update application message',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
    );
  }
}

// helper function to build the application message
export async function buildApplicationMessage(positions: Position[]) {
  let content = '# __Welcome to Job Applications__\n\n';

  if (positions.length === 0) {
    content += pl.noneAvailable;
    return { content, components: [] };
  }

  content += pl.available;

  const components = [];
  const maxButtonsPerRow = 5;
  let currentRow = [];

  // Track emoji usage for duplicate button style cycling
  const emojiUsageCount = new Map<string, number>();
  const styleCycle = [
    ButtonStyle.Primary,
    ButtonStyle.Secondary,
    ButtonStyle.Success,
    ButtonStyle.Danger,
  ];

  for (const position of positions) {
    const emoji = position.emoji || '📝';
    content += `## ${emoji} __${position.title}__\n${position.description}\n\n`;

    // Determine button style based on emoji usage count
    const usageCount = emojiUsageCount.get(emoji) || 0;
    emojiUsageCount.set(emoji, usageCount + 1);
    const buttonStyle = styleCycle[usageCount % styleCycle.length];

    const button = new ButtonBuilder()
      .setCustomId(`apply_${position.id}`)
      .setLabel(`Apply - ${position.title}`.substring(0, 80))
      .setStyle(buttonStyle)
      .setEmoji(emoji);

    currentRow.push(button);

    // if row is full or this is the last position, add the row
    if (currentRow.length === maxButtonsPerRow || position === positions[positions.length - 1]) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...currentRow));
      currentRow = [];
    }
  }

  return { content, components };
}

/**
 * Autocomplete handler for position selection
 */
export async function applicationPositionAutocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId || '';
  const focused = interaction.options.getFocused().toLowerCase();

  try {
    const positions = await positionRepo.find({
      where: { guildId },
      order: { displayOrder: 'ASC' },
    });

    const filtered = positions
      .filter(
        pos => pos.title.toLowerCase().includes(focused) || pos.id.toString().includes(focused),
      )
      .slice(0, 25)
      .map(pos => ({
        name: `#${pos.displayOrder} ${pos.emoji || '📝'} ${pos.title} (ID: ${pos.id})${pos.isActive ? '' : ' [inactive]'}`,
        value: pos.id.toString(),
      }));

    await interaction.respond(
      filtered.length > 0 ? filtered : [{ name: pl.autocomplete.noPositions, value: '0' }],
    );
  } catch {
    await interaction.respond([]);
  }
}
