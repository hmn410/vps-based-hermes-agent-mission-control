// Derives the CURRENT block/attention facts for one kanban task from its
// canonical event history, so the Postgres mirror never depends on the
// globally-truncated HermesTaskEvent log (newest 500 / API newest 150).
//
// Hermes semantics this mirrors (hermes_cli/kanban_db.py):
// - block_task() emits `blocked` with {reason, kind, recurrences}.
// - A same-kind re-block after an unblock increments block_recurrences; at
//   BLOCK_RECURRENCE_LIMIT (2) the task is routed to `triage` (NOT `blocked`)
//   with a `block_loop_detected` event. That is the "blocked a second time"
//   case HQ previously rendered as a plain neutral "Triage" card.
// - `gave_up` is the dispatcher breaker parking a task after repeated
//   crashes/failures; `dependency_wait` parks in `todo` until a parent lands.
// - block_kind / block_recurrences survive unblock (only completion clears
//   them), so they alone cannot tell whether a task is blocked *now*.

export const BLOCK_EVENT_KINDS = new Set(["blocked", "block_loop_detected", "gave_up", "dependency_wait"]);
// Lifecycle events after which an earlier block is no longer the current state.
// (`specified` is NOT one: the auto-specifier edits a triaged card in place.)
const CLEARING_KINDS = new Set(["unblocked", "promoted", "claimed", "completed", "review_requested", "archived"]);
// Events that count as a human-relevant block occurrence in the history.
const BLOCK_OCCURRENCE_KINDS = new Set(["blocked", "block_loop_detected", "gave_up"]);

function parsePayload(payload) {
  if (payload && typeof payload === "object") return payload;
  if (typeof payload !== "string" || !payload) return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { reason: payload };
  }
}

function reasonFrom(kind, payload) {
  for (const key of ["reason", "error", "message", "detail"]) {
    if (typeof payload[key] === "string" && payload[key].trim()) return payload[key].trim();
  }
  if (kind === "dependency_wait" && typeof payload.parent === "string") return `Waiting on parent ${payload.parent}`;
  return null;
}

/**
 * @param {Array<{id:number, kind:string, payload:unknown, created_at:number}>} events any order
 * @returns {{ blockReason: string|null, blockEventKind: string|null, blockedAt: number|null, blockCount: number }}
 *   blockedAt is unix seconds (kanban convention). blockCount = total block
 *   occurrences in the task's history (blocked + block_loop_detected + gave_up).
 */
export function deriveBlockState(events = []) {
  const ordered = [...events].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  let latest = null;
  let blockCount = 0;
  for (const event of ordered) {
    if (BLOCK_OCCURRENCE_KINDS.has(event.kind)) blockCount += 1;
    if (BLOCK_EVENT_KINDS.has(event.kind)) latest = event;
    // A later lifecycle move means the earlier block is history, not current.
    else if (latest && CLEARING_KINDS.has(event.kind)) latest = null;
  }
  if (!latest) return { blockReason: null, blockEventKind: null, blockedAt: null, blockCount };
  const payload = parsePayload(latest.payload);
  return {
    blockReason: reasonFrom(latest.kind, payload)?.slice(0, 4000) ?? null,
    blockEventKind: latest.kind,
    blockedAt: Number.isFinite(latest.created_at) ? latest.created_at : null,
    blockCount,
  };
}

// Statuses where a block reason is (or may be) the current state. A running/
// ready/done card keeps its historical block_kind, but its block is over.
const PARKED_STATUSES = new Set(["blocked", "triage", "todo"]);

/** True when the bridge should fetch/derive block detail for this task. */
export function needsBlockDetail(task) {
  const status = String(task?.status || "").toLowerCase();
  if (status === "blocked") return true;
  return PARKED_STATUSES.has(status) && (Boolean(task?.block_kind) || Number(task?.block_recurrences || 0) > 0);
}
