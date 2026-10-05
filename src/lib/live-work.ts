export type WorkTask = { id: string; status: string };
export type WorkEvent = { id: number; taskId: string; createdAt?: Date | string };

type EventRecord = {
  id: number;
  taskId: string;
  kind: string;
  payload: string | null;
  createdAt: Date | string;
};
type TaskRecord = { id: string; title: string };

export type TelemetryHealth = {
  available: boolean;
  stale: boolean;
  lastSuccessfulEventReadAt: string | null;
  newestEventId: number | null;
  error: string | null;
};

function normalizedStatus(status: string): string {
  return status.toLowerCase().replace(/[\s_-]+/g, "");
}

export function activeTasks<T extends WorkTask>(tasks: T[]): T[] {
  return tasks.filter((task) => {
    const status = normalizedStatus(task.status);
    return !status.includes("done") && !status.includes("archiv") && !status.includes("complete");
  });
}

function eventTime(event: WorkEvent): number {
  const t = event.createdAt ? new Date(event.createdAt).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Newest first by (createdAt, id). Ids from different sources (live dashboard
 *  vs. SQLite snapshot) can arrive out of order, so time wins and id breaks ties. */
export function compareEventsNewestFirst(a: WorkEvent, b: WorkEvent): number {
  return eventTime(b) - eventTime(a) || b.id - a.id;
}

export function activityForTask<T extends WorkEvent>(events: T[], taskId: string): T[] {
  return events
    .filter((event) => event.taskId === taskId)
    .sort(compareEventsNewestFirst);
}

function payloadSize(event: WorkEvent): number {
  const p = (event as { payload?: unknown }).payload;
  return typeof p === "string" ? p.length : 0;
}

/**
 * Merge a freshly polled event window into what the client already holds.
 * - dedupe by id (incoming copy wins unless its payload is poorer)
 * - an empty / shorter / stale poll never erases newer events already shown
 * - newest first by (createdAt, id), capped to `limit`
 */
export function mergeTaskEvents<T extends WorkEvent>(previous: T[], incoming: T[], limit = 800): T[] {
  const byId = new Map<number, T>();
  for (const event of previous) byId.set(event.id, event);
  for (const event of incoming) {
    const existing = byId.get(event.id);
    if (!existing || payloadSize(event) >= payloadSize(existing)) byId.set(event.id, event);
  }
  return [...byId.values()].sort(compareEventsNewestFirst).slice(0, limit);
}

/** Newest activity time for a task (for "last update" labels); null if none. */
export function latestActivityAt<T extends WorkEvent>(events: T[], taskId: string): string | null {
  const newest = activityForTask(events, taskId)[0];
  if (!newest?.createdAt) return null;
  return new Date(newest.createdAt).toISOString();
}

export function telemetryHealth(data: Record<string, unknown>, now = Date.now()): TelemetryHealth {
  const lastRead = typeof data.lastSuccessfulEventReadAt === "string" ? data.lastSuccessfulEventReadAt : null;
  const parsed = lastRead ? new Date(lastRead).getTime() : NaN;
  // A mirror that has not read event telemetry for two normal mirror intervals is stale.
  const stale = !Number.isFinite(parsed) || now - parsed > 10_000;
  const available = data.eventAvailability === "available" && !stale;
  return {
    available,
    stale,
    lastSuccessfulEventReadAt: lastRead,
    newestEventId: typeof data.newestEventId === "number" ? data.newestEventId : null,
    error: typeof data.eventError === "string" ? data.eventError : null,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Turns sparse worker telemetry into an operator-readable status line. */
export function describeExecutionEvent(kind: string, payload: string | null): string {
  if (kind !== "heartbeat") return kind;
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = payload ? JSON.parse(payload) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch { /* an unparseable source payload is simply detail-free */ }
  const note = stringValue(data.note);
  const step = stringValue(data.current_step_key) ?? stringValue(data.step) ?? stringValue(data.action) ?? stringValue(data.message);
  const tool = stringValue(data.tool) ?? stringValue(data.tool_name);
  const progress = stringValue(data.progress) ?? stringValue(data.phase);
  const details = [note, step ? `running ${step}` : null, tool, progress].filter((value): value is string => Boolean(value));
  return details.length
    ? `Heartbeat — ${details.join(" · ")}`
    : "Heartbeat — worker is still running; no step detail was reported";
}

export function projectExecutionFeed<T extends EventRecord>(events: T[], tasks: TaskRecord[]) {
  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  return [...events]
    .sort(compareEventsNewestFirst)
    .map((event) => ({
      ...event,
      title: titles.get(event.taskId) ?? event.taskId,
      taskLabel: titles.has(event.taskId) ? `${titles.get(event.taskId)} · ${event.taskId}` : event.taskId,
    }));
}
