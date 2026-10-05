// Single source of truth for "what does this Hermes task need from a human?"
// Every HQ surface that shows a kanban task's status (the /tasks board and its
// detail modal, the live orchestrator, dispatch lifecycle, the approval inbox,
// agent chat) derives its label/tone/"needs you" from here so they cannot drift.
//
// State model (grounded in hermes_cli/kanban_db.py):
// - approval      HQ-side pre-flight gate: an AgentRequest in `awaiting_approval`
//                 (side-effecting dispatch). Never a kanban status. Not derived here.
// - needs_input / capability / transient
//                 kanban `blocked` (or `triage` after a loop) with that block_kind:
//                 a worker called kanban_block and a human must act.
// - repeat_block  Hermes routes the 2nd same-kind block (block_recurrences >= 2,
//                 BLOCK_RECURRENCE_LIMIT) to `triage` with `block_loop_detected`.
//                 Still needs a human — previously rendered as a neutral "Triage".
// - gave_up       dispatcher breaker parked the task after repeated crashes.
// - dependency    `todo` + dependency_wait: auto-resumes, no human action.
// - review        `review`: Hermes dispatches its own reviewer; informational,
//                 NOT approval-required.

export type AttentionKind =
  | "none"
  | "needs_input"
  | "capability"
  | "transient"
  | "blocked"
  | "repeat_block"
  | "gave_up"
  | "dependency"
  | "review";

export type Tone = "neutral" | "up" | "down" | "warn" | "accent";

export type TaskAttentionInput = {
  status: string;
  blockKind?: string | null;
  blockReason?: string | null;
  blockEventKind?: string | null;
  blockRecurrences?: number | null;
  blockCount?: number | null;
  lastFailureError?: string | null;
};

export type TaskAttention = {
  kind: AttentionKind;
  /** A human must do something (answer, fix access, unblock) for this task to move. */
  needsYou: boolean;
  /** Board column the card belongs in. Loop-triaged tasks go in Blocked, not Triage. */
  column: "triage" | "todo" | "ready" | "running" | "review" | "blocked" | "done";
  label: string;
  tone: Tone;
  reason: string | null;
  /** How many times this task has been blocked (>=2 shown as "blocked N×"). */
  recurrences: number;
  /** Unblock is a valid action (dashboard PATCH status=ready → unblock / re-promote). */
  canUnblock: boolean;
};

const HUMAN_BLOCK_KINDS = new Set(["needs_input", "capability", "transient"]);
const KIND_LABEL: Record<string, string> = {
  needs_input: "Needs your input",
  capability: "Needs access/capability",
  transient: "Blocked (flaky failure)",
};

function norm(status: string): string {
  return (status || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function baseColumn(status: string): TaskAttention["column"] {
  const k = norm(status);
  for (const c of ["triage", "todo", "ready", "running", "review", "blocked", "done"] as const) if (k.includes(c)) return c;
  if (k.includes("progress") || k.includes("doing")) return "running";
  if (k.includes("complete") || k.includes("archiv")) return "done";
  return "triage";
}

/** Legacy mirror rows stored the raw `blocked` event JSON in lastFailureError. */
function readableReason(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const key of ["reason", "error", "message"]) {
        const v = parsed[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return null;
    } catch { /* not JSON, show as-is */ }
  }
  return text;
}

export function deriveTaskAttention(task: TaskAttentionInput): TaskAttention {
  const column = baseColumn(task.status);
  const recurrences = Math.max(Number(task.blockRecurrences || 0), Number(task.blockCount || 0));
  const reason = readableReason(task.blockReason) ?? readableReason(task.lastFailureError);
  const kind = task.blockKind ?? null;
  const loop = task.blockEventKind === "block_loop_detected";
  const none = (label: string, tone: Tone): TaskAttention => ({
    kind: "none", needsYou: false, column, label, tone, reason: null, recurrences, canUnblock: false,
  });

  if (column === "done") return none("Done", "up");
  if (column === "running") return none("Running", "accent");
  if (column === "ready") return none("Ready", "accent");
  if (column === "review") {
    return { kind: "review", needsYou: false, column, label: "In review", tone: "warn", reason: null, recurrences, canUnblock: false };
  }

  // Currently parked on a block? `blocked` always is. `triage`/`todo` are only
  // when the bridge found a current block event (block_kind alone survives
  // unblock and is NOT evidence of a current block).
  const currentlyBlocked = column === "blocked" || Boolean(task.blockEventKind);
  if (!currentlyBlocked) return none(column === "todo" ? "To do" : "Triage", "neutral");

  if (task.blockEventKind === "dependency_wait" || kind === "dependency") {
    return { kind: "dependency", needsYou: false, column, label: "Waiting on parent task", tone: "neutral", reason, recurrences, canUnblock: false };
  }
  if (task.blockEventKind === "gave_up") {
    return { kind: "gave_up", needsYou: true, column: "blocked", label: "Gave up after repeated failures", tone: "down", reason, recurrences, canUnblock: true };
  }
  if (loop || (column === "triage" && recurrences >= 2)) {
    return {
      kind: "repeat_block", needsYou: true, column: "blocked",
      label: `Blocked again${recurrences >= 2 ? ` (${recurrences}×)` : ""}${kind && KIND_LABEL[kind] ? ` · ${KIND_LABEL[kind].toLowerCase()}` : ""}`,
      tone: "down", reason, recurrences, canUnblock: true,
    };
  }
  if (kind && HUMAN_BLOCK_KINDS.has(kind)) {
    return { kind: kind as AttentionKind, needsYou: true, column: "blocked", label: KIND_LABEL[kind], tone: "down", reason, recurrences, canUnblock: true };
  }
  // Untyped block (dashboard drag / failure breaker): still a human action.
  return { kind: "blocked", needsYou: true, column: "blocked", label: "Blocked", tone: "down", reason, recurrences, canUnblock: true };
}

/** Prisma `where` for mirrored tasks that may need a human; refine with deriveTaskAttention. */
export const ATTENTION_CANDIDATE_STATUSES = ["blocked", "triage", "todo"];
