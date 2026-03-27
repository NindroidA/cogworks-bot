import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type MessageComponentInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { MemoryTag } from '../../../typeorm/entities/memory';
import { Colors, lang } from '../../../utils';

const tl = lang.memory;

/**
 * Selection state for tag category/status selection UI
 */
export interface TagSelectionState {
  categoryId: string | null;
  categoryName: string | null;
  statusId: string;
  statusName: string;
  [key: string]: string | null;
}

interface TagSelectionConfig {
  /** Prefix for component custom IDs (e.g., 'memory_add' or 'memory_capture') */
  prefix: string;
  /** Embed title */
  title: string;
  /** Optional description below title */
  description?: string;
}

interface TagOption {
  label: string;
  value: string;
  emoji: string | undefined;
}

/**
 * Build select menu rows and button row for tag selection
 */
function buildTagSelectionComponents(
  categoryOptions: TagOption[],
  statusOptions: TagOption[],
  state: TagSelectionState,
  config: TagSelectionConfig,
) {
  const categorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${config.prefix}_category`)
      .setPlaceholder(tl.add.selectCategory)
      .addOptions(
        categoryOptions.map(opt => ({
          ...opt,
          default: opt.value === state.categoryId,
        })),
      ),
  );

  const statusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${config.prefix}_status`)
      .setPlaceholder(tl.add.selectStatus)
      .addOptions(
        statusOptions.map(opt => ({
          ...opt,
          default: opt.value === state.statusId,
        })),
      ),
  );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${config.prefix}_continue`)
      .setLabel(lang.general.buttons.continue)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!state.categoryId),
    new ButtonBuilder()
      .setCustomId(`${config.prefix}_cancel`)
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  return { categorySelect, statusSelect, buttonRow };
}

/**
 * Build the selection embed showing current category/status choices
 */
function buildTagSelectionEmbed(state: TagSelectionState, config: TagSelectionConfig) {
  const embed = new EmbedBuilder()
    .setTitle(config.title)
    .setColor(Colors.brand.primary)
    .addFields(
      {
        name: tl.tagSelection.categoryField,
        value: state.categoryName || tl.tagSelection.notSelected,
        inline: true,
      },
      {
        name: tl.tagSelection.statusField,
        value: state.statusName || tl.tagSelection.notSelected,
        inline: true,
      },
    );

  if (config.description) {
    embed.setDescription(config.description);
  }

  return embed;
}

/**
 * Run the tag selection collector flow.
 * Returns the final selection state when user clicks Continue, or null if cancelled/timed out.
 */
export async function runTagSelectionCollector(
  interaction: ChatInputCommandInteraction,
  categoryTags: MemoryTag[],
  statusTags: MemoryTag[],
  state: TagSelectionState,
  config: TagSelectionConfig,
  onContinue: (i: MessageComponentInteraction) => Promise<void>,
): Promise<void> {
  const categoryOptions = categoryTags.map(tag => ({
    label: tag.name,
    value: tag.id.toString(),
    emoji: tag.emoji || undefined,
  }));

  const statusOptions = statusTags.map(tag => ({
    label: tag.name,
    value: tag.id.toString(),
    emoji: tag.emoji || undefined,
  }));

  const initialComponents = buildTagSelectionComponents(categoryOptions, statusOptions, state, config);

  const response = await interaction.reply({
    embeds: [buildTagSelectionEmbed(state, config)],
    components: [initialComponents.categorySelect, initialComponents.statusSelect, initialComponents.buttonRow],
    flags: [MessageFlags.Ephemeral],
  });

  const collector = response.createMessageComponentCollector({ time: 120000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({
        content: lang.errors.notYourInteraction,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (i.customId === `${config.prefix}_cancel`) {
      collector.stop('cancelled');
      await i.update({
        content: lang.errors.cancelled,
        embeds: [],
        components: [],
      });
      return;
    }

    if (i.customId === `${config.prefix}_continue`) {
      collector.stop('continue');
      await onContinue(i);
      return;
    }

    if (i.isStringSelectMenu()) {
      const selectInteraction = i as StringSelectMenuInteraction;
      const selectedValue = selectInteraction.values[0];

      if (selectInteraction.customId === `${config.prefix}_category`) {
        const tag = categoryTags.find(t => t.id.toString() === selectedValue);
        state.categoryId = selectedValue;
        state.categoryName = tag?.emoji ? `${tag.emoji} ${tag.name}` : tag?.name || null;
      } else if (selectInteraction.customId === `${config.prefix}_status`) {
        const tag = statusTags.find(t => t.id.toString() === selectedValue);
        state.statusId = selectedValue;
        state.statusName = tag?.emoji ? `${tag.emoji} ${tag.name}` : tag?.name || 'Unknown';
      }

      const updated = buildTagSelectionComponents(categoryOptions, statusOptions, state, config);
      await selectInteraction.update({
        embeds: [buildTagSelectionEmbed(state, config)],
        components: [updated.categorySelect, updated.statusSelect, updated.buttonRow],
      });
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') {
      interaction.editReply({ content: lang.errors.timeout, embeds: [], components: [] }).catch(() => null);
    }
  });
}

/**
 * Initialize default selection state from tags
 */
export function createDefaultSelectionState(statusTags: MemoryTag[]): TagSelectionState {
  const defaultStatus = statusTags.find(t => t.name === 'Open') || statusTags[0];
  return {
    categoryId: null,
    categoryName: null,
    statusId: defaultStatus.id.toString(),
    statusName: defaultStatus.emoji ? `${defaultStatus.emoji} ${defaultStatus.name}` : defaultStatus.name,
  };
}
