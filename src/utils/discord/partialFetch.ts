/**
 * Best-effort partial hydration for reaction events.
 *
 * Reaction handlers receive partial reactions/users/messages and must fetch
 * them before use. A failed fetch (typically 10008 — the message was deleted
 * before we got to it) means the event can't be processed; that's expected
 * churn, so it's logged at debug level rather than swallowed silently — the
 * old bare `catch { return; }` blocks hid real permission/API failures too.
 */

import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

/**
 * Fetch a partial entity. Returns false when the fetch fails (caller bails).
 *
 * @example
 * if (reaction.partial && !(await fetchPartial(reaction, 'reaction'))) return;
 * if (user.partial && !(await fetchPartial(user, 'user'))) return;
 */
export async function fetchPartial(entity: { fetch: () => Promise<unknown> }, label: string): Promise<boolean> {
  try {
    await entity.fetch();
    return true;
  } catch (error) {
    enhancedLogger.debug(
      `Skipping reaction event — partial ${label} fetch failed (likely deleted)`,
      LogCategory.SYSTEM,
      {
        label,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
    return false;
  }
}
