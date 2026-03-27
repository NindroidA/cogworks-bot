/**
 * Shared Workflow Helpers
 *
 * Generic workflow utilities used by both ticket and application workflow systems.
 * Avoids duplicating status history, status lookup, and status mapping logic.
 */

/**
 * Append a status change to an entity's status history array, capping at maxEntries.
 * Works with any entity that has a `statusHistory` array of `{ status, changedBy, changedAt, note? }`.
 */
export function appendStatusHistory(
  entity: { statusHistory: Array<{ status: string; changedBy: string; changedAt: string; note?: string }> | null },
  status: string,
  changedBy: string,
  maxEntries: number,
  note?: string,
): void {
  const history = entity.statusHistory || [];
  history.push({
    status,
    changedBy,
    changedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
  if (history.length > maxEntries) {
    entity.statusHistory = history.slice(history.length - maxEntries);
  } else {
    entity.statusHistory = history;
  }
}

/**
 * Find a workflow status definition by ID.
 * Works with any status type that has an `id` field.
 */
export function findStatusById<T extends { id: string }>(statuses: T[], statusId: string): T | undefined {
  return statuses.find(s => s.id === statusId);
}
