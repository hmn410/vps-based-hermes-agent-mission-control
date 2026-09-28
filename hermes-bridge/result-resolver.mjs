const FALLBACK = "Task completed on the kanban board.";

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function completionEventSummary(events) {
  for (const event of events) {
    if (event?.kind !== "completed" || !event.payload) continue;
    try {
      const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
      const summary = text(payload?.summary);
      if (summary) return summary;
    } catch {
      // A malformed historical event should not prevent completion sync.
    }
  }
  return null;
}

/**
 * Return the most useful human completion output Hermes recorded for a task.
 * The task-level result is authoritative; short task runs commonly store their
 * final answer in `summary` instead, and completed-event payloads are the last
 * useful source before the neutral fallback.
 */
export function resolveTaskResult(task, runs = [], events = []) {
  return (
    text(task?.result) ||
    runs.map((run) => text(run?.summary)).find(Boolean) ||
    completionEventSummary(events) ||
    FALLBACK
  );
}

const COMPLETED_STATUSES = new Set(["done", "completed", "archived"]);

/**
 * Normalise the result persisted to the web mirror. An active task must not
 * gain a fabricated completion message simply because it has not written a
 * result yet. Terminal tasks get the full completion-output fallback chain.
 */
export function resolveMirroredTaskResult(task, runs = [], events = []) {
  const status = String(task?.status || "").toLowerCase();
  if (!COMPLETED_STATUSES.has(status)) return text(task?.result);
  return resolveTaskResult(task, runs, events);
}
