import { deriveRequestLifecycle } from "./kanban-request-lifecycle";
import { deriveTaskAttention } from "./task-attention";

/* Recent events (AgentEvent) are an append-only log: a kanban-linked dispatch
   writes "Started: …" and "Queued as kanban task t_…" once and nothing ever
   updates those rows. Without the request/task's CURRENT lifecycle next to
   them, History showed long-finished work as still queued. This projects each
   in-flight-style event (level "info" with meta.requestId / meta.taskId) onto
   the live AgentRequest + mirrored HermesTask state on every poll. */

export type ActivityTone = "neutral" | "accent" | "warn" | "up" | "down";
export type ActivityCurrentState = {
  status: string;
  label: string;
  tone: ActivityTone;
  taskId: string | null;
};

type EventLike = { level: string; meta?: unknown };
type RequestLike = { id: string; status: string; createdAt: Date; hermesTaskId?: string | null };
type TaskLike = Parameters<typeof deriveRequestLifecycle>[1] & { id: string; status: string };

export function activityLinks(meta: unknown): { requestId: string | null; taskId: string | null } {
  const m = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { requestId: str(m.requestId), taskId: str(m.taskId) };
}

const REQUEST_STATE: Record<string, { label: string; tone: ActivityTone }> = {
  done: { label: "Done", tone: "up" },
  failed: { label: "Failed", tone: "down" },
  rejected: { label: "Rejected", tone: "down" },
  awaiting_approval: { label: "Awaiting approval", tone: "warn" },
  queued: { label: "Queued", tone: "neutral" },
  approved: { label: "Queued", tone: "neutral" },
  waiting_for_dispatch: { label: "Queued", tone: "neutral" },
  review: { label: "In review", tone: "warn" },
  running: { label: "Running", tone: "accent" },
};

function fromTask(task: TaskLike): ActivityCurrentState {
  const s = task.status.toLowerCase();
  if (["done", "completed", "archived"].includes(s)) return { status: "done", label: "Done", tone: "up", taskId: task.id };
  const a = deriveTaskAttention(task);
  if (a.needsYou) return { status: "blocked", label: a.label, tone: "down", taskId: task.id };
  if (s === "running") return { status: "running", label: "Running", tone: "accent", taskId: task.id };
  if (s === "review") return { status: "review", label: "In review", tone: "warn", taskId: task.id };
  return { status: "waiting_for_dispatch", label: a.kind === "dependency" ? a.label : "Queued", tone: "neutral", taskId: task.id };
}

/** Current lifecycle for one activity event, or null when the event is
 *  already a terminal record (Done/Failed, level != info) or links nothing. */
export function currentActivityState(
  event: EventLike,
  requestsById: Map<string, RequestLike>,
  tasksById: Map<string, TaskLike>,
  now = new Date(),
): ActivityCurrentState | null {
  if (event.level !== "info") return null;
  const { requestId, taskId: metaTaskId } = activityLinks(event.meta);
  if (!requestId && !metaTaskId) return null;
  const request = requestId ? requestsById.get(requestId) : undefined;
  const taskId = request?.hermesTaskId ?? metaTaskId;
  const task = taskId ? tasksById.get(taskId) : undefined;
  if (request) {
    // Handed to kanban but not mirrored yet: queued, not running.
    if (request.hermesTaskId && !task && request.status === "running") {
      return { status: "waiting_for_dispatch", label: "Queued", tone: "neutral", taskId: request.hermesTaskId };
    }
    const lc = deriveRequestLifecycle(request, task ?? null, [], now);
    if (lc.status === "blocked") return { status: "blocked", label: lc.label, tone: "down", taskId: taskId ?? null };
    const meta = REQUEST_STATE[lc.status] ?? { label: lc.label, tone: "neutral" as ActivityTone };
    return { status: lc.status, label: meta.label, tone: meta.tone, taskId: taskId ?? null };
  }
  if (task) return fromTask(task);
  // Linked request deleted and task archived off the board: say so rather
  // than leave the row implying it is still queued.
  return { status: "gone", label: "No longer on board", tone: "neutral", taskId: taskId ?? null };
}
