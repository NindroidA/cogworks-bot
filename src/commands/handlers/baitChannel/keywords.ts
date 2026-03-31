import {
  type AutocompleteInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { BaitKeyword } from '../../../typeorm/entities/bait/BaitKeyword';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { awaitConfirmation, handleInteractionError, lang, stripZeroWidthChars } from '../../../utils';
import { DEFAULT_KEYWORDS } from '../../../utils/baitChannel/defaultKeywords';
import { MAX } from '../../../utils/constants';
import { lazyRepo } from '../../../utils/database/lazyRepo';

// Re-export for backwards compatibility
export { DEFAULT_KEYWORDS } from '../../../utils/baitChannel/defaultKeywords';

const keywordRepo = lazyRepo(BaitKeyword);
const tl = lang.baitChannel;

/**
 * Seed default keywords for a guild if none exist.
 * Called from bait channel setup and the bot setup wizard.
 */
export async function seedDefaultKeywords(guildId: string, createdBy = 'system'): Promise<number> {
  const existingCount = await keywordRepo.count({ where: { guildId } });
  if (existingCount > 0) return 0;

  const entities = DEFAULT_KEYWORDS.map(k =>
    keywordRepo.create({
      guildId,
      keyword: k.keyword,
      weight: k.weight,
      createdBy,
    }),
  );

  // Use insert with orIgnore to handle any edge-case duplicates
  await keywordRepo.createQueryBuilder().insert().into(BaitKeyword).values(entities).orIgnore().execute();

  return DEFAULT_KEYWORDS.length;
}

export async function handleKeywords(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const action = interaction.options.getString('action', true);
    const guildId = interaction.guildId!;

    switch (action) {
      case 'add':
        await handleAdd(client, interaction, guildId);
        break;
      case 'remove':
        await handleRemove(client, interaction, guildId);
        break;
      case 'list':
        await handleList(interaction, guildId);
        break;
      case 'reset':
        await handleReset(client, interaction, guildId);
        break;
      default:
        await interaction.reply({
          content: lang.errors.unknownSubcommand,
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.keywords);
  }
}

async function handleAdd(client: Client, interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const rawKeyword = interaction.options.getString('keyword');
  if (!rawKeyword) {
    await interaction.reply({
      content: tl.keywords.add.missingKeyword,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const keyword = stripZeroWidthChars(rawKeyword.toLowerCase().trim());
  if (keyword.length < 1 || keyword.length > 100) {
    await interaction.reply({
      content: tl.keywords.add.invalidLength,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const weight = interaction.options.getInteger('weight') ?? 5;

  // Check guild keyword limit
  const count = await keywordRepo.count({ where: { guildId } });
  if (count >= MAX.BAIT_KEYWORDS_PER_GUILD) {
    await interaction.reply({
      content: tl.keywords.add.limitReached,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check for duplicate
  const existing = await keywordRepo.findOne({ where: { guildId, keyword } });
  if (existing) {
    await interaction.reply({
      content: tl.keywords.add.duplicate.replace('{keyword}', keyword),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await keywordRepo.save(
    keywordRepo.create({
      guildId,
      keyword,
      weight,
      createdBy: interaction.user.id,
    }),
  );

  // Invalidate cache
  const { baitChannelManager } = client as ExtendedClient;
  baitChannelManager?.clearKeywordCache(guildId);

  const newCount = count + 1;
  const embed = new EmbedBuilder()
    .setColor('#00FF00')
    .setTitle(tl.keywords.add.title)
    .setDescription(tl.keywords.add.success.replace('{keyword}', keyword).replace('{weight}', weight.toString()))
    .setFooter({
      text: tl.keywords.list.footer.replace('{count}', newCount.toString()),
    });

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

async function handleRemove(client: Client, interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const keyword = interaction.options.getString('keyword');
  if (!keyword) {
    await interaction.reply({
      content: tl.keywords.remove.missingKeyword,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const result = await keywordRepo.delete({
    guildId,
    keyword: keyword.toLowerCase().trim(),
  });
  if (!result.affected) {
    await interaction.reply({
      content: tl.keywords.remove.notFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const { baitChannelManager } = client as ExtendedClient;
  baitChannelManager?.clearKeywordCache(guildId);

  await interaction.reply({
    content: tl.keywords.remove.success.replace('{keyword}', keyword),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleList(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const keywords = await keywordRepo.find({
    where: { guildId },
    order: { weight: 'DESC' },
  });

  if (keywords.length === 0) {
    await interaction.reply({
      content: tl.keywords.list.empty,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const lines = keywords.map(k => `**${k.weight}** — \`${k.keyword}\``);
  const description = lines.join('\n');

  // Split into multiple fields if description is too long
  const embed = new EmbedBuilder().setColor('#0099FF').setTitle(tl.keywords.list.title);

  if (description.length <= 4096) {
    embed.setDescription(description);
  } else {
    // Chunk into fields of ~1000 chars
    let chunk = '';
    let fieldIndex = 1;
    for (const line of lines) {
      if (chunk.length + line.length + 1 > 1024) {
        embed.addFields({ name: `Keywords (${fieldIndex})`, value: chunk });
        chunk = line;
        fieldIndex++;
      } else {
        chunk += (chunk ? '\n' : '') + line;
      }
    }
    if (chunk) {
      embed.addFields({ name: `Keywords (${fieldIndex})`, value: chunk });
    }
  }

  embed.setFooter({
    text: tl.keywords.list.footer.replace('{count}', keywords.length.toString()),
  });

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

async function handleReset(client: Client, interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const result = await awaitConfirmation(interaction, {
    message: tl.keywords.reset.confirm,
    confirmLabel: 'Confirm Reset',
    confirmStyle: ButtonStyle.Danger,
  });
  if (!result) return;

  // Delete all and re-seed
  await keywordRepo.delete({ guildId });

  const entities = DEFAULT_KEYWORDS.map(k =>
    keywordRepo.create({
      guildId,
      keyword: k.keyword,
      weight: k.weight,
      createdBy: 'system',
    }),
  );
  await keywordRepo.save(entities);

  const { baitChannelManager } = client as ExtendedClient;
  baitChannelManager?.clearKeywordCache(guildId);

  await result.interaction.editReply({
    content: tl.keywords.reset.success.replace('{count}', DEFAULT_KEYWORDS.length.toString()),
  });
}

/** Autocomplete handler for keyword remove action */
export async function handleKeywordAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const focusedValue = interaction.options.getFocused().toLowerCase();

  try {
    const keywords = await keywordRepo.find({ where: { guildId } });
    const filtered = focusedValue ? keywords.filter(k => k.keyword.includes(focusedValue)) : keywords;

    await interaction.respond(
      filtered.slice(0, 25).map(k => ({
        name: `${k.keyword} (weight: ${k.weight})`,
        value: k.keyword,
      })),
    );
  } catch {
    await interaction.respond([]);
  }
}
