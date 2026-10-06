import type { ForumChannel } from 'discord.js';
import { MemoryTag, type MemoryTagType } from '../../../typeorm/entities/memory';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { mergeForumTags } from '../../../utils/forumTagManager';
import { DEFAULT_MEMORY_TAGS } from '../../../utils/setup/channelDefaults';

const memoryTagRepo = lazyRepo(MemoryTag);

interface WantedTag {
  name: string;
  emoji: string | null;
  tagType: MemoryTagType;
  isDefault: boolean;
}

/**
 * Seed a memory config's tags onto its forum and into `memory_tags`, additively.
 *
 * - A row whose `discordTagId` is still one of the forum's tags is left alone,
 *   even if an admin renamed that tag in Discord: re-running setup on the same
 *   forum changes nothing. Matching it by name instead would add a second tag
 *   and move the row off the one existing posts carry.
 * - Every other wanted tag (a default with no row, or a row whose tag is gone,
 *   e.g. after /bot-setup moved the config to another forum) goes through
 *   `mergeForumTags`: it reuses a same-named forum tag or appends one, and
 *   never removes the forum's own tags or the tags applied to its posts.
 *   Replacing the list deleted every one of them in Discord.
 * - Rows are upserted by (guildId, memoryConfigId, name), so a re-run never
 *   duplicates them. Duplicates left by earlier versions are not cleaned up.
 *
 * Used by /memory-setup (setup, add-channel) and the /bot-setup memory flow.
 * `tag-reset` deliberately replaces and keeps its own confirmed path.
 */
export async function seedMemoryTags(guildId: string, memoryConfigId: number, forum: ForumChannel): Promise<void> {
  const rows = await memoryTagRepo.find({ where: { guildId, memoryConfigId } });
  const rowByName = new Map(rows.map(r => [r.name.toLowerCase(), r]));
  const liveTagIds = new Set(forum.availableTags.map(t => t.id));
  const isLinked = (row: MemoryTag | undefined) => !!row?.discordTagId && liveTagIds.has(row.discordTagId);

  const wanted: WantedTag[] = [
    ...DEFAULT_MEMORY_TAGS.category.map(t => ({ ...t, tagType: 'category' as const, isDefault: true })),
    ...DEFAULT_MEMORY_TAGS.status.map(t => ({ ...t, tagType: 'status' as const, isDefault: true })),
  ];
  const wantedNames = new Set(wanted.map(w => w.name.toLowerCase()));
  for (const row of rows) {
    if (wantedNames.has(row.name.toLowerCase())) continue;
    wantedNames.add(row.name.toLowerCase());
    wanted.push({ name: row.name, emoji: row.emoji, tagType: row.tagType, isDefault: row.isDefault });
  }

  const missing = wanted.filter(w => !isLinked(rowByName.get(w.name.toLowerCase())));
  if (missing.length === 0) return;

  const { ids } = await mergeForumTags(forum, missing);

  const toSave = missing.map(w => {
    const row =
      rowByName.get(w.name.toLowerCase()) ??
      memoryTagRepo.create({
        guildId,
        memoryConfigId,
        name: w.name,
        emoji: w.emoji,
        tagType: w.tagType,
        isDefault: w.isDefault,
      });
    row.discordTagId = ids.get(w.name) ?? null;
    return row;
  });

  await memoryTagRepo.save(toSave);
}
