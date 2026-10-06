// Human-action handoff for a kanban task that needs Josh ("Needs you").
//
// Why this exists: the HQ mirror only carries truncated previews of what a
// worker wrote — board result previews (~200 chars), comment previews (280
// chars, whitespace collapsed), follow-up items (500 chars) — and the inbox
// line-clamps those again. A worker's exact command block in a comment or its
// kanban_complete summary therefore never reached the dashboard intact.
//
// deriveTaskHandoff() reads the FULL canonical task detail (Hermes dashboard
// GET /api/plugins/kanban/tasks/:id: task, comments, events, runs) and pulls
// out, verbatim, only what the worker actually wrote:
//   - why       current block reason / explicit completion follow-ups
//   - commands  fenced ``` code blocks, verbatim (copyable; never executed)
//   - steps     numbered list lines outside code fences (exact UI steps)
//   - where / expected / after   explicitly labelled lines, or a structured
//               `handoff` object in the run metadata
// It NEVER manufactures commands. When nothing exact was recorded the result
// is `state: "absent"` and the UI says so — it does not pretend there are steps.
// `hqNext` is the dashboard's own, factual description of what clears the
// item (Unblock vs. archive); it is labelled as HQ behaviour, not worker text.

export type HandoffSourceKind = "block_reason" | "comment" | "run_summary" | "run_metadata";

export type HandoffSource = {
  kind: HandoffSourceKind;
  label: string;
  author: string | null;
  /** unix seconds */
  at: number | null;
  /** Full, untruncated text exactly as recorded. */
  text: string;
};

export type HandoffCommand = { code: string; lang: string | null; sourceIndex: number };

export type TaskHandoff = {
  /** exact = commands and/or steps were recorded; absent = none were. */
  state: "exact" | "absent";
  /** What put this item in Needs you. */
  trigger: "blocked" | "follow_up" | "none";
  why: string | null;
  commands: HandoffCommand[];
  steps: string[];
  where: string | null;
  expected: string | null;
  after: string | null;
  /** Fields the worker did not state (shown explicitly, never filled in). */
  missing: Array<"why" | "commands_or_steps" | "where" | "expected" | "after">;
  /** HQ-side fact about what clears this item. */
  hqNext: string;
  sources: HandoffSource[];
};

// Shapes of the dashboard detail payload we read (subset).
type DetailEvent = { id?: number; kind?: string; payload?: unknown; created_at?: number; run_id?: number | null };
type DetailComment = { id?: number; author?: string; body?: string; created_at?: number };
type DetailRun = {
  id?: number; status?: string; outcome?: string | null; summary?: string | null;
  metadata?: unknown; started_at?: number; ended_at?: number | null;
};
export type TaskDetailPayload = {
  task?: { id?: string; status?: string; result?: string | null; latest_summary?: string | null } | null;
  comments?: DetailComment[] | null;
  events?: DetailEvent[] | null;
  runs?: DetailRun[] | null;
};

const BLOCK_KINDS = new Set(["blocked", "block_loop_detected", "gave_up"]);
// Mirrors hermes-bridge/block-state.mjs: events after which an earlier block is history.
const CLEARING_KINDS = new Set([
  "unblocked", "promoted", "promoted_manual", "claimed", "completed", "review_requested",
  "archived", "status", "reclaimed", "changes_requested", "review_reopened",
]);
// Mirrors hermes-bridge/follow-up.mjs (the explicit completion follow-up contract).
const FOLLOW_UP_KEYS: Array<[string, string | null]> = [
  ["follow_up", null], ["follow_ups", null], ["human_follow_up", null],
  ["action_required", "Action required"], ["needs_confirmation", "Needs your confirmation"],
  ["approval_required", "Needs your approval"], ["needs_approval", "Needs your approval"],
  ["deploy_required", "Deploy required (VPS host)"],
];

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.map(str).filter((v): v is string => Boolean(v));
    return parts.length ? parts.join("\n") : null;
  }
  return null;
}

function itemText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const obj = asObject(value);
  if (obj) for (const k of ["title", "text", "action", "summary", "description"]) { const s = str(obj[k]); if (s) return s; }
  return null;
}

function followUpItems(meta: Record<string, unknown> | null): string[] {
  if (!meta) return [];
  const out: string[] = [];
  for (const [key, label] of FOLLOW_UP_KEYS) {
    const v = meta[key];
    if (v == null || v === false || v === "") continue;
    if (v === true) { if (label) out.push(label); continue; }
    for (const item of Array.isArray(v) ? v : [v]) {
      const t = itemText(item);
      if (t) out.push(label ? `${label}: ${t}` : t);
    }
  }
  return [...new Set(out)];
}

/**
 * Current block event (same currency rule as hermes-bridge/block-state.mjs),
 * the earlier `blocked` event it follows (a loop event may carry no reason),
 * and when the attempt that blocked began (last clearing event before it).
 */
function currentBlock(events: DetailEvent[], status: string) {
  let latest: DetailEvent | null = null;
  let lastBlocked: DetailEvent | null = null;
  let lastClearAt: number | null = null;
  let attemptStart: number | null = null;
  for (const e of [...events].sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0))) {
    const kind = String(e.kind);
    if (BLOCK_KINDS.has(kind)) {
      if (!latest) attemptStart = lastClearAt;
      latest = e;
      if (kind === "blocked") lastBlocked = e;
    } else if (CLEARING_KINDS.has(kind)) {
      latest = null;
      lastClearAt = Number.isFinite(Number(e.created_at)) ? Number(e.created_at) : lastClearAt;
    }
  }
  if (!latest) return null;
  const expected = latest.kind === "block_loop_detected" ? "triage" : "blocked";
  if (status !== expected) return null;
  return { event: latest, previousBlocked: lastBlocked, attemptStart };
}

function blockReasonText(event: DetailEvent): string | null {
  const payload = asObject(event.payload) ?? (typeof event.payload === "string" ? { reason: event.payload } : null);
  if (!payload) return null;
  for (const k of ["reason", "error", "message", "detail"]) { const s = str(payload[k]); if (s) return s; }
  return null;
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const LABELS: Array<[keyof Pick<TaskHandoff, "why" | "where" | "expected" | "after">, RegExp]> = [
  ["why", /^(?:why(?: (?:action is )?needed)?|reason)$/i],
  ["where", /^(?:where(?: to run(?: (?:it|them|this))?)?|run (?:on|in|from)|location)$/i],
  ["expected", /^(?:expected(?: (?:result|outcome|output))?|success(?: looks like)?|you should see)$/i],
  ["after", /^(?:after(?:wards?)?|then|next(?: steps?)?|what happens next|afterwards?|verify|verification|follow[- ]?up check|retry|unblock)$/i],
];
const LABEL_LINE = /^\s*(?:[-*]\s+)?(?:\*\*|__)?([A-Za-z][A-Za-z \-]{1,40}?)(?:\*\*|__)?\s*[:\u2014]\s*(?:\*\*|__)?\s*(.*)$/;
const STEP_LINE = /^\s*(\d{1,2})[.)]\s+(\S.*)$/;

type Parsed = {
  commands: Array<{ code: string; lang: string | null }>;
  steps: string[];
  labels: Partial<Record<"why" | "where" | "expected" | "after", string>>;
};

/** Verbatim extraction from one source text. Exported for tests. */
export function parseHandoffText(text: string): Parsed {
  const out: Parsed = { commands: [], steps: [], labels: {} };
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let fence: { marker: string; lang: string | null; body: string[] } | null = null;
  for (const line of lines) {
    const fm = line.match(FENCE);
    if (fence) {
      if (fm && fm[1][0] === fence.marker[0] && fm[1].length >= fence.marker.length && !fm[2]) {
        const code = fence.body.join("\n").replace(/^\n+|\s+$/g, "");
        if (code) out.commands.push({ code, lang: fence.lang });
        fence = null;
      } else fence.body.push(line);
      continue;
    }
    if (fm) { fence = { marker: fm[1], lang: fm[2] || null, body: [] }; continue; }
    const step = line.match(STEP_LINE);
    if (step) { out.steps.push(step[2].trim()); continue; }
    const lm = line.match(LABEL_LINE);
    if (lm && lm[2].trim()) {
      const name = lm[1].trim();
      for (const [field, re] of LABELS) {
        if (re.test(name) && !out.labels[field]) { out.labels[field] = lm[2].trim(); break; }
      }
    }
  }
  // An unterminated fence is still exactly what the worker wrote.
  if (fence) {
    const code = fence.body.join("\n").replace(/^\n+|\s+$/g, "");
    if (code) out.commands.push({ code, lang: fence.lang });
  }
  return out;
}

function structuredHandoff(meta: Record<string, unknown> | null) {
  const h = asObject(meta?.handoff) ?? asObject(meta?.human_handoff);
  if (!h) return null;
  const commandsRaw = h.commands ?? h.command;
  const commands = (Array.isArray(commandsRaw) ? commandsRaw : commandsRaw == null ? [] : [commandsRaw])
    .map((c) => (typeof c === "string" ? c.replace(/\s+$/, "") : null))
    .filter((c): c is string => Boolean(c && c.trim()));
  const stepsRaw = h.steps ?? h.ui_steps;
  const steps = (Array.isArray(stepsRaw) ? stepsRaw : stepsRaw == null ? [] : [stepsRaw])
    .map(itemText).filter((s): s is string => Boolean(s));
  return {
    commands, steps,
    why: str(h.why) ?? str(h.reason),
    where: str(h.where) ?? str(h.run_on) ?? str(h.location),
    expected: str(h.expected) ?? str(h.expected_result) ?? str(h.success),
    after: str(h.after) ?? str(h.next) ?? str(h.verify) ?? str(h.then),
  };
}

/**
 * @param detail full dashboard task detail payload
 * @param attentionKind deriveTaskAttention(...).kind for the mirrored task
 */
export function deriveTaskHandoff(detail: TaskDetailPayload, attentionKind?: string | null): TaskHandoff {
  const status = String(detail?.task?.status || "").toLowerCase();
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const comments = Array.isArray(detail?.comments) ? [...detail.comments] : [];
  const runs = Array.isArray(detail?.runs) ? detail.runs : [];
  const runById = new Map(runs.map((r) => [Number(r.id), r]));
  const sources: HandoffSource[] = [];
  let why: string | null = null;
  let cutoff: number | null = null;
  let trigger: TaskHandoff["trigger"] = "none";
  let structured: ReturnType<typeof structuredHandoff> = null;

  const block = currentBlock(events, status);
  if (block) {
    trigger = "blocked";
    const reasonEvent = blockReasonText(block.event) ? block.event : block.previousBlocked;
    why = reasonEvent ? blockReasonText(reasonEvent) : null;
    if (why) sources.push({ kind: "block_reason", label: "Block reason", author: null, at: reasonEvent?.created_at ?? null, text: why });
    // Workers comment the handoff, then block: include every comment from the
    // attempt that blocked onward (earlier attempts' comments are history).
    const run = block.event.run_id != null ? runById.get(Number(block.event.run_id)) : undefined;
    cutoff = run?.started_at ?? block.attemptStart ?? null;
  } else if (status === "done" || status === "completed") {
    const completed = runs
      .filter((r) => r.outcome === "completed" || r.status === "done")
      .sort((a, b) => Number(a.ended_at ?? 0) - Number(b.ended_at ?? 0) || Number(a.id ?? 0) - Number(b.id ?? 0));
    const run = completed[completed.length - 1];
    const meta = asObject(run?.metadata);
    const items = followUpItems(meta);
    structured = structuredHandoff(meta);
    if (items.length || structured || attentionKind === "follow_up") {
      trigger = "follow_up";
      why = items.length ? items.join("\n") : null;
      const summary = str(run?.summary) ?? str(detail?.task?.latest_summary) ?? str(detail?.task?.result);
      if (summary) sources.push({ kind: "run_summary", label: "Completion summary", author: null, at: run?.ended_at ?? null, text: summary });
      if (structured) sources.push({ kind: "run_metadata", label: "Completion metadata (handoff)", author: null, at: run?.ended_at ?? null, text: JSON.stringify(meta?.handoff ?? meta?.human_handoff, null, 2) });
      cutoff = run?.started_at ?? null;
    }
  }

  if (trigger !== "none") {
    for (const c of comments.sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0) || Number(a.id ?? 0) - Number(b.id ?? 0))) {
      const body = typeof c.body === "string" ? c.body.trim() : "";
      if (!body) continue;
      if (cutoff != null && Number(c.created_at ?? 0) < cutoff) continue;
      sources.push({ kind: "comment", label: `Comment from ${c.author || "unknown"}`, author: c.author ?? null, at: c.created_at ?? null, text: body });
    }
  }

  const commands: HandoffCommand[] = [];
  const steps: string[] = [];
  const labels: Parsed["labels"] = {};
  if (structured) {
    // Index of the metadata source, so commands point at where they came from.
    const metaIdx = sources.findIndex((s) => s.kind === "run_metadata");
    for (const code of structured.commands) commands.push({ code, lang: "bash", sourceIndex: metaIdx });
    steps.push(...structured.steps);
    for (const k of ["why", "where", "expected", "after"] as const) if (structured[k]) labels[k] = structured[k]!;
  }
  sources.forEach((src, i) => {
    if (src.kind === "run_metadata") return;
    const p = parseHandoffText(src.text);
    for (const c of p.commands) if (!commands.some((x) => x.code === c.code)) commands.push({ ...c, sourceIndex: i });
    for (const s of p.steps) if (!steps.includes(s)) steps.push(s);
    for (const k of ["why", "where", "expected", "after"] as const) if (p.labels[k] && !labels[k]) labels[k] = p.labels[k];
  });

  const finalWhy = why ?? labels.why ?? null;
  const exact = commands.length > 0 || steps.length > 0;
  const missing: TaskHandoff["missing"] = [];
  if (!finalWhy) missing.push("why");
  if (!exact) missing.push("commands_or_steps");
  if (!labels.where) missing.push("where");
  if (!labels.expected) missing.push("expected");
  if (!labels.after) missing.push("after");

  return {
    state: exact ? "exact" : "absent",
    trigger,
    why: finalWhy,
    commands,
    steps,
    where: labels.where ?? null,
    expected: labels.expected ?? null,
    after: labels.after ?? null,
    missing,
    hqNext: trigger === "blocked"
      ? "Nothing runs automatically. After you act (or answer), press Unblock: the task returns to ready and its worker is re-dispatched to continue and verify."
      : trigger === "follow_up"
        ? "The task itself is done and will not retry. Once you have handled this, archive the card on Tasks to clear it from Needs you."
        : "This task is not currently waiting on you.",
    sources,
  };
}
