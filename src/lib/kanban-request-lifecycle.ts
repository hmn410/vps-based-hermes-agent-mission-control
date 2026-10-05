import { deriveTaskAttention, type TaskAttention } from "./task-attention";

export const DISPATCH_ATTENTION_MS = 2 * 60 * 1000;

type RequestLike = {
  status: string;
  createdAt: Date;
  hermesTaskId?: string | null;
};

type TaskLike = {
  id: string;
  status: string;
  startedAt?: Date | null;
  blockKind?: string | null;
  blockReason?: string | null;
  blockEventKind?: string | null;
  blockRecurrences?: number | null;
  blockCount?: number | null;
  lastFailureError?: string | null;
  followUps?: unknown;
  syncedAt?: Date | null;
};

type EventLike = {
  taskId: string;
  kind: string;
  createdAt: Date;
  payload?: string | null;
};

export type RequestLifecycle = {
  status: string;
  label: string;
  queueAgeMs: number | null;
  dispatcherAttention: boolean;
  latestEvent: { kind: string; createdAt: Date; message: string | null } | null;
  blockerReason: string | null;
  mirrorFreshnessMs: number | null;
  /** Shared task-attention projection (null when there is no live mirrored task). */
  attention: TaskAttention | null;
};

function parseEventMessage(payload?: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    for (const key of ["reason", "error", "message", "summary", "detail"]) {
      if (typeof parsed[key] === "string" && parsed[key].trim()) return parsed[key].trim();
    }
  } catch {
    return payload.slice(0, 300);
  }
  return null;
}

export function deriveRequestLifecycle(
  request: RequestLike,
  task: TaskLike | null | undefined,
  events: EventLike[] = [],
  now = new Date(),
): RequestLifecycle {
  const queueAgeMs = request.hermesTaskId && !task?.startedAt
    ? Math.max(0, now.getTime() - request.createdAt.getTime())
    : null;
  const latest = events
    .filter((event) => event.taskId === request.hermesTaskId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const latestEvent = latest
    ? { kind: latest.kind, createdAt: latest.createdAt, message: parseEventMessage(latest.payload) }
    : null;
  const mirrorFreshnessMs = task?.syncedAt ? Math.max(0, now.getTime() - task.syncedAt.getTime()) : null;
  const base = { latestEvent, mirrorFreshnessMs };

  if (!request.hermesTaskId || !task) {
    return {
      ...base,
      status: request.status,
      label: request.status === "awaiting_approval"
        ? "Awaiting approval"
        : request.status === "queued" ? "Queued for dispatcher" : request.status,
      queueAgeMs,
      dispatcherAttention: request.status === "queued" && (queueAgeMs ?? 0) >= DISPATCH_ATTENTION_MS,
      blockerReason: null,
      attention: null,
    };
  }

  const taskStatus = task.status.toLowerCase();
  if (["done", "completed", "archived"].includes(taskStatus)) {
    // A completed task can still need Josh (explicit completion follow-ups).
    const doneAttention = deriveTaskAttention(task);
    const followUp = doneAttention.kind === "follow_up";
    return {
      ...base, status: "done", label: followUp ? doneAttention.label : "Done", queueAgeMs: null,
      dispatcherAttention: false, blockerReason: null, attention: followUp ? doneAttention : null,
    };
  }
  const attention = deriveTaskAttention(task);
  // Needs a human — including Hermes' 2nd same-kind block, which lands in
  // `triage` (block_loop_detected) and previously read as "Queued for dispatcher".
  if (attention.needsYou) {
    return {
      ...base,
      status: "blocked",
      label: attention.label,
      queueAgeMs: null,
      dispatcherAttention: false,
      blockerReason: attention.reason || latestEvent?.message || task.blockKind || "Waiting for input",
      attention,
    };
  }
  if (attention.kind === "dependency") {
    return { ...base, status: "waiting_for_dispatch", label: attention.label, queueAgeMs, dispatcherAttention: false, blockerReason: null, attention };
  }
  if (["ready", "todo", "triage"].includes(taskStatus)) {
    return {
      ...base,
      status: "waiting_for_dispatch",
      label: "Queued for dispatcher",
      queueAgeMs,
      dispatcherAttention: (queueAgeMs ?? 0) >= DISPATCH_ATTENTION_MS,
      blockerReason: null,
      attention,
    };
  }
  if (taskStatus === "review") {
    return { ...base, status: "review", label: "In review", queueAgeMs: null, dispatcherAttention: false, blockerReason: null, attention };
  }
  return { ...base, status: "running", label: "Running", queueAgeMs: null, dispatcherAttention: false, blockerReason: null, attention };
}
