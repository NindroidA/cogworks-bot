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
  enhancedLogger,
  guardFeatureRateLimit,
  LogCategory,
  lang,
  RateLimits,
  replyEphemeralError,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { CUSTOM_EMOJI, isUnicodeEmoji } from '../../../utils/discord/emoji';
import { getTemplate } from './applicationTemplates';

const positionRepo = lazyRepo(Position);
const pl = lang.application.position;

export async function applicationPositionHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const subCommand = interaction.options.getSubcommand();
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  const guard = await guardFeatureRateLimit(interaction, 'applications', 'manage', {
    action: 'application-position',
    limit: RateLimits.APPLICATION_POSITION,
    scope: 'guild',
  });
  if (!guard.allowed) return;

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
        await replyEphemeralError(interaction, pl.templateNotFound);
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
        await replyEphemeralError(interaction, pl.provideEither);
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

      enhancedLogger.info(`Position added: "${finalTitle}" (ID: ${newPosition.id})`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        positionId: newPosition.id,
        template: template || 'custom',
      });

      // update the application channel message
      await syncPanel(interaction, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to add position',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        {
          userId: interaction.user.id,
          guildId,
        },
      );
      await replyEphemeralError(interaction, pl.failAdd);
    }
  } else if (subCommand === 'remove') {
    const positionValue = interaction.options.getString('position', true);
    const positionId = parseInt(positionValue, 10);

    try {
      const position = await positionRepo.findOne({
        where: { id: positionId, guildId },
      });

      if (!position) {
        await replyEphemeralError(interaction, pl.notFound);
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
      await syncPanel(interaction, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to remove position',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        {
          userId: interaction.user.id,
          guildId,
        },
      );
      await replyEphemeralError(interaction, pl.failRemove);
    }
  } else if (subCommand === 'toggle') {
    const positionValue = interaction.options.getString('position', true);
    const positionId = parseInt(positionValue, 10);

    try {
      const position = await positionRepo.findOne({
        where: { id: positionId, guildId },
      });

      if (!position) {
        await replyEphemeralError(interaction, pl.notFound);
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
        {
          userId: interaction.user.id,
          guildId,
          positionId,
        },
      );

      // update the application channel message
      await syncPanel(interaction, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to toggle position',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        {
          userId: interaction.user.id,
          guildId,
        },
      );
      await replyEphemeralError(interaction, pl.failToggle);
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
        {
          userId: interaction.user.id,
          guildId,
        },
      );
      await replyEphemeralError(interaction, pl.failList);
    }
  } else if (subCommand === 'refresh') {
    try {
      const result = await updateApplicationMessage(interaction.client, guildId);
      if (result === 'failed' || result === 'no-panel') {
        await replyEphemeralError(interaction, pl.failRefresh);
        return;
      }

      await interaction.reply({
        content: result === 'truncated' ? `${pl.successRefresh}\n${pl.panelTooMany}` : pl.successRefresh,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (error) {
      enhancedLogger.error(
        'Failed to refresh application message',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId },
      );
      await replyEphemeralError(interaction, pl.failRefresh);
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

      enhancedLogger.info(`Positions reindexed: ${positions.length} positions`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
      });

      // Update the application channel message
      await syncPanel(interaction, guildId);
    } catch (error) {
      enhancedLogger.error(
        'Failed to reindex positions',
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.COMMAND_EXECUTION,
        {
          userId: interaction.user.id,
          guildId,
        },
      );
      await replyEphemeralError(interaction, pl.failReindex);
    }
  }
}

/** What a panel re-render did: edited (`truncated`: some positions didn't fit), no panel set up yet, or Discord refused. */
export type PanelUpdate = 'updated' | 'truncated' | 'no-panel' | 'failed';

/** Re-renders the panel after a change. The change is saved either way, so a panel problem is only a warning. */
async function syncPanel(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const result = await updateApplicationMessage(interaction.client, guildId);
  const warning = result === 'failed' ? pl.panelUpdateFailed : result === 'truncated' ? pl.panelTooMany : null;
  if (warning) await interaction.followUp({ content: warning, flags: [MessageFlags.Ephemeral] });
}

// function to update the application message with current positions
export async function updateApplicationMessage(client: Client, guildId: string): Promise<PanelUpdate> {
  try {
    const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
    const applicationConfig = await applicationConfigRepo.findOneBy({
      guildId,
    });

    if (!applicationConfig?.channelId || !applicationConfig.messageId) return 'no-panel';

    const channel = await client.channels.fetch(applicationConfig.channelId);
    if (!channel?.isTextBased()) return 'failed';

    const message = await channel.messages.fetch(applicationConfig.messageId);

    // get active positions
    const activePositions = await positionRepo.find({
      where: { guildId, isActive: true },
      order: { displayOrder: 'ASC' },
    });

    // build the message content and components
    const { content, components, hidden } = buildApplicationMessage(activePositions);

    await message.edit({
      content,
      components,
    });
    return hidden > 0 ? 'truncated' : 'updated';
  } catch (error) {
    enhancedLogger.error(
      'Failed to update application message',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    return 'failed';
  }
}

/** Discord allows 5 rows of 5 buttons and 2000 characters of content per message. */
const PANEL_MAX_POSITIONS = 25;
const PANEL_CONTENT_LIMIT = 2000;
const DEFAULT_POSITION_EMOJI = '📝';

/**
 * The position's emoji when Discord takes it on a button, else 📝. Positions
 * store free text (slash add, the edit modal, the dashboard), and one bad
 * emoji made every edit of the panel fail.
 */
export function panelEmoji(emoji: string | null | undefined): string {
  const value = emoji?.trim();
  if (!value) return DEFAULT_POSITION_EMOJI;
  return CUSTOM_EMOJI.test(value) || isUnicodeEmoji(value) ? value : DEFAULT_POSITION_EMOJI;
}

/** Shortens descriptions to `budget` characters in total: short ones stay whole, long ones share the rest. */
function fitDescriptions(descriptions: string[], budget: number): string[] {
  const fitted = [...descriptions];
  let left = Math.max(0, budget);
  const byLength = fitted.map((_, i) => i).sort((a, b) => fitted[a].length - fitted[b].length);
  byLength.forEach((index, n) => {
    const share = Math.floor(left / (byLength.length - n));
    if (fitted[index].length > share) fitted[index] = share > 0 ? `${fitted[index].slice(0, share - 1)}…` : '';
    left -= fitted[index].length;
  });
  return fitted;
}

// helper function to build the application message
export function buildApplicationMessage(positions: Position[]) {
  let content = '# __Welcome to Job Applications__\n\n';

  if (positions.length === 0) {
    content += pl.noneAvailable;
    return { content, components: [], hidden: 0 };
  }

  content += pl.available;

  // Positions past the 25th get no button, so they aren't listed either.
  const shown = positions.slice(0, PANEL_MAX_POSITIONS);
  const headings = shown.map(position => `## ${panelEmoji(position.emoji)} __${position.title}__\n`);
  const budget = PANEL_CONTENT_LIMIT - content.length - headings.join('').length - 2 * shown.length;
  const descriptions = fitDescriptions(
    shown.map(position => position.description ?? ''),
    budget,
  );
  content += shown.map((_, i) => `${headings[i]}${descriptions[i]}\n\n`).join('');

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const maxButtonsPerRow = 5;

  // Track emoji usage for duplicate button style cycling
  const emojiUsageCount = new Map<string, number>();
  const styleCycle = [ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Success, ButtonStyle.Danger];

  shown.forEach((position, i) => {
    const emoji = panelEmoji(position.emoji);

    // Determine button style based on emoji usage count
    const usageCount = emojiUsageCount.get(emoji) || 0;
    emojiUsageCount.set(emoji, usageCount + 1);
    const buttonStyle = styleCycle[usageCount % styleCycle.length];

    const button = new ButtonBuilder()
      .setCustomId(`apply_${position.id}`)
      .setLabel(`Apply - ${position.title}`.substring(0, 80))
      .setStyle(buttonStyle)
      .setEmoji(emoji);

    if (i % maxButtonsPerRow === 0) components.push(new ActionRowBuilder<ButtonBuilder>());
    components[components.length - 1].addComponents(button);
  });

  // Backstop in case the titles alone run past the limit.
  return { content: content.slice(0, PANEL_CONTENT_LIMIT), components, hidden: positions.length - shown.length };
}

/**
 * Autocomplete handler for position selection
 */
export async function applicationPositionAutocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused().toLowerCase();

  try {
    const positions = await positionRepo.find({
      where: { guildId },
      order: { displayOrder: 'ASC' },
    });

    const filtered = positions
      .filter(pos => pos.title.toLowerCase().includes(focused) || pos.id.toString().includes(focused))
      .slice(0, 25)
      .map(pos => ({
        name: `#${pos.displayOrder} ${pos.emoji || '📝'} ${pos.title} (ID: ${pos.id})${pos.isActive ? '' : ' [inactive]'}`,
        value: pos.id.toString(),
      }));

    await interaction.respond(filtered.length > 0 ? filtered : [{ name: pl.autocomplete.noPositions, value: '0' }]);
  } catch {
    await interaction.respond([]);
  }
}
