export type SnapshotDecision<T> = {
  items: T[];
  stale: boolean;
};

/**
 * Preserve a known-good task snapshot through transient empty API responses.
 * A genuinely empty board must be marked confirmed by the server; an absent or
 * partial refresh never clears history in the browser.
 */
export function keepLastKnownSnapshot<T>(
  previous: T[],
  incoming: T[],
  confirmedEmpty: boolean,
): SnapshotDecision<T> {
  if (incoming.length > 0 || confirmedEmpty || previous.length === 0) {
    return { items: incoming, stale: false };
  }
  return { items: previous, stale: true };
}
