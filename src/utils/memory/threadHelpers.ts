import type { ThreadChannel, ThreadEditOptions } from 'discord.js';
import { truncateWithNotice } from '../validation/inputSanitizer';

/** Discord's content limit for a bot message, including a forum post's starter message. */
const STARTER_MESSAGE_MAX = 2000;

/** Discord's limit on a thread name, which is a memory item's title. */
export const MEMORY_TITLE_MAX = 100;

/**
 * Description cap for the add/capture modals. The starter message also carries
 * a "**Description:**" prefix and a footer (capture's has the source author and
 * a jump link, ~170 chars), so the modal can't offer the full 2000. It used to
 * offer 4000 and anything over ~1960 failed on submit.
 */
export const MEMORY_DESCRIPTION_MAX = 1800;

/**
 * Build a memory post's starter message: the description section (if any) then
 * the footer. The description is clamped so the whole message fits Discord's
 * 2000-char limit, ending in a visible "(content truncated)" notice when cut —
 * sanitizing can lengthen input (e.g. a zero-width char per @everyone).
 */
export function buildStarterContent(description: string, footer: string): string {
  if (!description) return footer;
  const prefix = '**Description:**\n\n';
  const separator = '\n\n';
  const room = STARTER_MESSAGE_MAX - prefix.length - separator.length - footer.length;
  return `${prefix}${truncateWithNotice(description, room)}${separator}${footer}`;
}

/** The status that closes an item: update-status locks and archives its thread. */
const COMPLETED_STATUS = 'Completed';

/**
 * Replace a memory thread's applied tags. Discord rejects any edit to an
 * archived thread (50083) unless `archived: false` is part of the same request,
 * and a Completed item is locked + archived, so this unarchives it in that
 * request. The thread is unlocked only when the item is being reopened (its old
 * status is Completed and the new one isn't): any other change keeps the lock,
 * so a thread a moderator locked on purpose stays locked.
 *
 * @returns whether the thread was archived before and whether this reopened
 * it, so a caller that isn't reopening can archive it again.
 */
export async function editMemoryThreadTags(
  thread: ThreadChannel,
  appliedTags: string[],
  status: { from: string; to: string },
): Promise<{ wasArchived: boolean; reopened: boolean }> {
  const wasArchived = thread.archived === true;
  const reopened = status.from === COMPLETED_STATUS && status.to !== COMPLETED_STATUS;
  const edit: ThreadEditOptions = { appliedTags };
  if (wasArchived) edit.archived = false;
  if (reopened && thread.locked) edit.locked = false;
  await thread.edit(edit);
  return { wasArchived, reopened };
}
