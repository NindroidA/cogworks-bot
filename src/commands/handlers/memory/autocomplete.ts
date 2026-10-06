import type { AutocompleteInteraction } from 'discord.js';
import { Like } from 'typeorm';
import { MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const memoryItemRepo = lazyRepo(MemoryItem);
const memoryTagRepo = lazyRepo(MemoryTag);

export async function memoryAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  if (focused.name === 'thread') {
    const query = focused.value.toLowerCase();
    const items = await memoryItemRepo.find({
      where: query ? { guildId, title: Like(`%${query}%`) } : { guildId },
      order: { updatedAt: 'DESC' },
      take: 25,
    });

    await interaction.respond(
      items.map(item => ({
        name: `${item.title} [${item.status}]`.slice(0, 100),
        value: item.threadId,
      })),
    );
  } else if (focused.name === 'status') {
    const query = focused.value.toLowerCase();

    // Each memory forum has its own copy of the status tags. Once the item is
    // picked, offer that forum's statuses: a same-named tag from another forum
    // has a different id. Without an item yet, dedupe by name across forums
    // (update-status re-resolves the name within the item's forum).
    const threadId = interaction.options.getString('thread');
    const item = threadId ? await memoryItemRepo.findOneBy({ guildId, threadId }) : null;
    const tags = await memoryTagRepo.find({
      where: item
        ? { guildId, tagType: 'status', memoryConfigId: item.memoryConfigId }
        : { guildId, tagType: 'status' },
    });

    const seen = new Set<string>();
    const unique = tags.filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });

    const filtered = query ? unique.filter(t => t.name.toLowerCase().includes(query)) : unique;

    await interaction.respond(
      filtered.map(tag => ({
        name: tag.emoji ? `${tag.emoji} ${tag.name}` : tag.name,
        value: tag.id.toString(),
      })),
    );
  }
}
