// Client-side reconciliation for /tasks card actions.
//
// The board reads the Postgres mirror (/api/hermes/tasks), which hermes-bridge
// refreshes on an interval. A successful archive therefore isn't visible in
// the very next load — and an in-flight poll started before the click can
// resolve afterwards with the old list. Without reconciliation the archived
// card re-renders with its button re-enabled, so the first click looks like it
// did nothing and a second click fails (the task is already archived).
//
// We record confirmed-successful archives as pending removals and filter them
// out of every snapshot until the mirror stops returning them (or a TTL
// expires, so a card can never be hidden forever by a stale entry).

export type PendingRemovals = Map<string, number>; // task id -> expiry (ms epoch)

export const PENDING_REMOVAL_TTL_MS = 60_000;

export function markRemoved(
  pending: PendingRemovals,
  id: string,
  now = Date.now(),
  ttlMs = PENDING_REMOVAL_TTL_MS,
): void {
  pending.set(id, now + ttlMs);
}

/**
 * Drop tasks that were archived successfully but are still present in a
 * lagging snapshot. Entries are cleared once the snapshot no longer contains
 * the id (mirror caught up) or once they expire.
 */
export function withoutPendingRemovals<T extends { id: string }>(
  tasks: T[],
  pending: PendingRemovals,
  now = Date.now(),
): T[] {
  if (pending.size === 0) return tasks;
  const present = new Set(tasks.map((t) => t.id));
  for (const [id, expiry] of pending) {
    if (!present.has(id) || expiry <= now) pending.delete(id);
  }
  if (pending.size === 0) return tasks;
  return tasks.filter((t) => !pending.has(t.id));
}

/** Human-readable failure text from a non-OK action response. */
export async function actionErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data && typeof data.error === "string" && data.error.trim()) return data.error;
  } catch {
    /* non-JSON body */
  }
  return `Request failed (${res.status})`;
}
