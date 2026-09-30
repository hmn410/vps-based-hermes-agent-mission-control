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
  lastFailureError?: string | null;
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

  if (!request.hermesTaskId || !task) {
    return {
      status: request.status,
      label: request.status === "queued" ? "Queued for dispatcher" : request.status,
      queueAgeMs,
      dispatcherAttention: request.status === "queued" && (queueAgeMs ?? 0) >= DISPATCH_ATTENTION_MS,
      latestEvent,
      blockerReason: null,
      mirrorFreshnessMs,
    };
  }

  const taskStatus = task.status.toLowerCase();
  if (["done", "completed", "archived"].includes(taskStatus)) {
    return { status: "done", label: "Done", queueAgeMs: null, dispatcherAttention: false, latestEvent, blockerReason: null, mirrorFreshnessMs };
  }
  if (taskStatus === "blocked") {
    return {
      status: "blocked",
      label: "Blocked",
      queueAgeMs: null,
      dispatcherAttention: false,
      latestEvent,
      blockerReason: task.lastFailureError || latestEvent?.message || task.blockKind || "Waiting for input",
      mirrorFreshnessMs,
    };
  }
  if (["ready", "todo", "triage"].includes(taskStatus)) {
    return {
      status: "waiting_for_dispatch",
      label: "Queued for dispatcher",
      queueAgeMs,
      dispatcherAttention: (queueAgeMs ?? 0) >= DISPATCH_ATTENTION_MS,
      latestEvent,
      blockerReason: null,
      mirrorFreshnessMs,
    };
  }
  if (taskStatus === "review") {
    return { status: "review", label: "In review", queueAgeMs: null, dispatcherAttention: false, latestEvent, blockerReason: null, mirrorFreshnessMs };
  }
  return { status: "running", label: "Running", queueAgeMs: null, dispatcherAttention: false, latestEvent, blockerReason: null, mirrorFreshnessMs };
}
