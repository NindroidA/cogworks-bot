import type { AutocompleteInteraction } from 'discord.js';
import { Like } from 'typeorm';
import { AppDataSource } from '../../../typeorm';
import { MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';

const memoryItemRepo = AppDataSource.getRepository(MemoryItem);
const memoryTagRepo = AppDataSource.getRepository(MemoryTag);

export async function memoryAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  const guildId = interaction.guildId || '';

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
    const tags = await memoryTagRepo.find({
      where: { guildId, tagType: 'status' },
    });

    // Deduplicate by name (tags across configs may share names)
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
