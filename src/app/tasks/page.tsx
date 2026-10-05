"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, LayoutGrid, Unlock, Check, Archive, X, Copy, ClipboardCheck } from "lucide-react";
import {
  Panel,
  SectionHeader,
  Pill,
  EmptyState,
  Skeleton,
  Eyebrow,
  rise,
} from "@/components/ui/kit";
import { LiveOrchestrator } from "@/components/live-orchestrator";
import { keepLastKnownSnapshot } from "@/lib/task-snapshot";
import {
  actionErrorMessage,
  markRemoved,
  withoutPendingRemovals,
  type PendingRemovals,
} from "@/lib/task-actions";
import { deriveTaskAttention } from "@/lib/task-attention";

// ── Types ─────────────────────────────────────────────────
interface KanbanTask {
  id: string;
  board: string;
  title: string;
  assignee: string | null;
  status: string;
  priority: number | null;
  result: string | null;
  blockKind?: string | null;
  blockReason?: string | null;
  blockEventKind?: string | null;
  blockRecurrences?: number | null;
  blockCount?: number | null;
  blockedAt?: string | null;
  lastFailureError?: string | null;
  followUps?: unknown;
  syncedAt: string;
}

// ── Helpers ───────────────────────────────────────────────
function timeAgo(d: string | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  if (Number.isNaN(diff)) return "—";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// Orchestrator columns — mirrors the real Hermes kanban lifecycle.
const COLUMN_ORDER = [
  "triage",
  "todo",
  "ready",
  "running",
  "review",
  "blocked",
  "done",
] as const;
type Column = (typeof COLUMN_ORDER)[number];

// Column placement is decided by deriveTaskAttention() (src/lib/task-attention):
// a repeat block that Hermes parked in `triage` belongs in Blocked.
type Tone = "neutral" | "up" | "down" | "warn" | "accent";
function columnTone(col: Column): Tone {
  if (col === "done") return "up";
  if (col === "running") return "accent";
  if (col === "blocked") return "down";
  if (col === "review") return "warn";
  return "neutral";
}
const COLUMN_LABEL: Record<Column, string> = {
  triage: "Triage",
  todo: "To do",
  ready: "Ready",
  running: "Running",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};
function toneVar(t: Tone): string {
  return t === "neutral" ? "var(--text-3)" : `var(--${t})`;
}

// ── Attention banner: current blocker reason + recurrence (shared model) ──
function AttentionNote({ task, clamp }: { task: KanbanTask; clamp: boolean }) {
  const a = deriveTaskAttention(task);
  if (!a.needsYou && a.kind !== "dependency") return null;
  // follow_up (completed task with explicit human follow-ups) uses the warn
  // tone; blocked / repeat-blocked use down.
  const accent = a.needsYou ? `var(--${a.tone === "neutral" ? "text-3" : a.tone})` : "var(--line)";
  return (
    <div
      className="mt-2.5 rounded-[8px] px-2.5 py-2 text-[11.5px] leading-snug"
      style={{
        color: a.needsYou ? accent : "var(--text-3)",
        background: a.needsYou ? `color-mix(in srgb, ${accent} 8%, transparent)` : "transparent",
        border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
      }}
      role={a.needsYou ? "status" : undefined}
    >
      <span className="font-semibold">{a.needsYou ? "Needs you · " : ""}{a.label}</span>
      {a.recurrences >= 2 && a.kind !== "repeat_block" && <span> · blocked {a.recurrences}×</span>}
      {a.kind === "follow_up" ? (
        <ul className={`mt-1 list-disc pl-4 text-[var(--text-2)] ${clamp ? "line-clamp-3" : ""}`}>
          {a.followUps.map((item, i) => <li key={i} className="whitespace-pre-wrap">{item}</li>)}
        </ul>
      ) : a.reason && <p className={`mt-1 text-[var(--text-2)] whitespace-pre-wrap ${clamp ? "line-clamp-3" : ""}`}>{a.reason}</p>}
      {task.blockedAt && a.kind !== "follow_up" && <p className="mt-1 num text-[10.5px] text-[var(--text-4)]">since {timeAgo(task.blockedAt)}</p>}
    </div>
  );
}

// ── Task detail modal — full title + full result, no truncation ──
function TaskDetailModal({ task, onClose }: { task: KanbanTask; onClose: () => void }) {
  const attention = deriveTaskAttention(task);
  const col = attention.column as Column;
  const tone = attention.needsYou ? attention.tone : columnTone(col);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyResult = async () => {
    if (!task.result) return;
    try {
      await navigator.clipboard.writeText(task.result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-2xl mt-10 sm:mt-0 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[var(--line)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={tone}>{attention.needsYou ? attention.label : COLUMN_LABEL[col]}</Pill>
              {task.assignee && (
                <span className="num text-[10.5px] text-[var(--text-3)]">Worker: {task.assignee}</span>
              )}
              <span className="num text-[10.5px] text-[var(--text-4)]">{task.id}</span>
            </div>
            <p className="mt-2 text-[15px] font-medium text-[var(--text)] leading-snug">{task.title}</p>
            <AttentionNote task={task} clamp={false} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost inline-flex items-center justify-center w-8 h-8 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto grow">
          {task.result ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <Eyebrow>Result</Eyebrow>
                <button
                  type="button"
                  onClick={copyResult}
                  className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                >
                  {copied ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[13.5px] text-[var(--text-2)] leading-relaxed whitespace-pre-wrap">
                {task.result}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-[var(--text-3)]">No result recorded for this task yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Kanban task card ──────────────────────────────────────
type TaskAction = "unblock" | "archive" | "complete";

function TaskCard({
  task,
  onActed,
  onOpen,
}: {
  task: KanbanTask;
  onActed: (taskId: string, action: TaskAction) => void;
  onOpen: (task: KanbanTask) => void;
}) {
  const attention = deriveTaskAttention(task);
  const col = attention.column as Column;
  const tone = attention.needsYou ? attention.tone : columnTone(col);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous re-entrancy guard: `busy` state isn't visible to a second
  // click that lands before React re-renders the disabled button.
  const inFlight = useRef(false);

  const act = async (
    e: React.MouseEvent,
    action: TaskAction,
    confirmMsg?: string,
  ) => {
    e.stopPropagation();
    if (inFlight.current) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    inFlight.current = true;
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/hermes/tasks/${encodeURIComponent(task.id)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (r.ok) onActed(task.id, action);
      else setError(await actionErrorMessage(r));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  // Only surface actions that make sense to clear up from here — this is a
  // shortcut for common cleanup, not a full kanban board replacement.
  // Unblock covers Hermes' loop-triaged repeat blocks too (status=triage), not
  // just the literal `blocked` column — dashboard PATCH status=ready re-promotes.
  const showUnblock = attention.canUnblock;
  const showComplete = col === "review" || col === "running";
  const showArchive = col === "done";

  return (
    <div
      className="panel p-3.5 cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]"
      style={{
        borderLeft: `2px solid color-mix(in srgb, ${toneVar(tone)} 55%, transparent)`,
      }}
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(task); }}
    >
      <p className="text-[13px] text-[var(--text)] leading-snug line-clamp-3">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap mt-2.5">
        <Pill tone={tone}>{attention.needsYou ? attention.label : COLUMN_LABEL[col]}</Pill>
        {task.assignee && (
          <span className="num text-[10.5px] text-[var(--text-3)]">Worker: {task.assignee}</span>
        )}
        {task.priority != null && task.priority > 0 && (
          <span className="num text-[10.5px] text-[var(--text-3)] ml-auto">P{task.priority}</span>
        )}
      </div>
      <AttentionNote task={task} clamp />
      {task.result && (
        <p className="mt-2.5 text-[11.5px] text-[var(--text-3)] leading-snug line-clamp-2 border-t border-[var(--line)] pt-2">
          {task.result}
        </p>
      )}
      {(showUnblock || showComplete || showArchive) && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2.5 border-t border-[var(--line)]">
          {showUnblock && (
            <button
              type="button"
              onClick={(e) => act(e, "unblock")}
              disabled={busy !== null}
              className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-[11px] disabled:opacity-40"
            >
              <Unlock className="w-3 h-3" /> {busy === "unblock" ? "…" : "Unblock"}
            </button>
          )}
          {showComplete && (
            <button
              type="button"
              onClick={(e) => act(e, "complete", `Mark "${task.title}" as done?`)}
              disabled={busy !== null}
              className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-[11px] disabled:opacity-40"
            >
              <Check className="w-3 h-3" /> {busy === "complete" ? "…" : "Mark done"}
            </button>
          )}
          {showArchive && (
            <button
              type="button"
              onClick={(e) => act(e, "archive", `Archive "${task.title}"? It will be removed from this board.`)}
              disabled={busy !== null}
              className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-[11px] disabled:opacity-40"
            >
              <Archive className="w-3 h-3" /> {busy === "archive" ? "…" : "Archive"}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-[var(--down)] leading-snug break-words">
          Action failed: {error}
        </p>
      )}
    </div>
  );
}

// ── Kanban board — full lifecycle, the historical record ──
function KanbanBoard({
  tasks,
  total,
  lastSync,
  stale,
  onActed,
  onOpen,
}: {
  tasks: KanbanTask[];
  total: number;
  lastSync: string | null;
  stale: boolean;
  onActed: (taskId: string, action: TaskAction) => void;
  onOpen: (task: KanbanTask) => void;
}) {
  const groups: Record<string, KanbanTask[]> = {};
  for (const t of tasks) {
    const col = deriveTaskAttention(t).column;
    (groups[col] ||= []).push(t);
  }

  return (
    <>
      <SectionHeader
        label="History"
        title="Every task, by lifecycle column"
        action={
          <div className="flex items-center gap-3">
            <span className="num text-[12px] text-[var(--text-2)]">{total} total</span>
            <span className={`num text-[11px] ${stale ? "text-[var(--warn)]" : "text-[var(--text-3)]"}`}>
              {stale ? "showing last successful snapshot" : `synced ${timeAgo(lastSync)}`}
            </span>
          </div>
        }
      />
      {tasks.length === 0 ? (
        <Panel className="p-2">
          <EmptyState
            icon={<LayoutGrid className="w-6 h-6" />}
            title="No tasks on the board"
            hint="Cards from the Hermes kanban board — including who each task is assigned to and its live status — show up here."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {COLUMN_ORDER.map((col) => {
            const items = (groups[col] || []).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
            return (
              <div key={col} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between px-1">
                  <Eyebrow>{COLUMN_LABEL[col]}</Eyebrow>
                  <span className="num text-[11px] text-[var(--text-3)]">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2.5 min-h-[40px]">
                  {items.length === 0 ? (
                    <p className="text-[var(--text-4)] text-[12px] text-center py-4">—</p>
                  ) : (
                    items.map((t) => <TaskCard key={t.id} task={t} onActed={onActed} onOpen={onOpen} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────
// This page is the orchestrator's own status view — live activity, then
// history. Dispatching new work and the AgentRequest approval queue live
// on /hermes; this page never touches that bus, only the kanban lifecycle.
export default function TasksPage() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskSync, setTaskSync] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [historyStale, setHistoryStale] = useState(false);
  // Deep link from the approval inbox / follow-up queue: /tasks?task=<id>
  // opens that task's detail modal. Lazy init (no effect): the modal only
  // renders once tasks load client-side, so SSR (null) can't mismatch.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("task"),
  );
  const lastTasks = useRef<KanbanTask[]>([]);
  // Successfully archived ids that the lagging mirror may still return.
  const pendingRemovals = useRef<PendingRemovals>(new Map());

  const load = useCallback(async () => {
    const tk = await getJSON<{
      tasks: KanbanTask[];
      counts: Record<string, number>;
      total: number;
      lastSync: string;
      confirmedEmpty: boolean;
    }>("/api/hermes/tasks");
    if (tk) {
      const snapshot = keepLastKnownSnapshot(lastTasks.current, tk.tasks ?? [], tk.confirmedEmpty === true);
      lastTasks.current = snapshot.items;
      setTasks(withoutPendingRemovals(snapshot.items, pendingRemovals.current));
      setHistoryStale(snapshot.stale);
      if (!snapshot.stale) {
        setTaskTotal(tk.total ?? tk.tasks?.length ?? 0);
        setTaskSync(tk.lastSync ?? null);
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, [load]);

  const onActed = useCallback(
    (taskId: string, action: TaskAction) => {
      if (action === "archive") {
        // Reflect the confirmed archive immediately; the bridge mirror
        // catches up on its next sync and the pending entry then clears.
        markRemoved(pendingRemovals.current, taskId);
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        setSelectedTaskId((sel) => (sel === taskId ? null : sel));
      }
      void load();
    },
    [load],
  );

  const manualRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Kanban lifecycle counts (not the dispatch/approval bus — that's on /hermes).
  // Header counts come from the same attention projection as the board, so a
  // loop-triaged repeat block counts as Blocked (not Triage) everywhere.
  const countFor = (col: Column) => tasks.filter((t) => deriveTaskAttention(t).column === col).length;
  const running = countFor("running");
  const blocked = countFor("blocked");
  const needsYou = tasks.filter((t) => deriveTaskAttention(t).needsYou).length;
  const review = countFor("review");
  const done = countFor("done");
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null;

  return (
    <>
      <div className="relative z-10 w-full mx-auto pt-4 pb-16">
        {/* Header */}
        <div className="hq-rise flex flex-wrap items-end justify-between gap-4 mb-8" style={rise(0)}>
          <div>
            <Eyebrow>Live from Hermes</Eyebrow>
            <h1 className="mt-2.5 text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
              Task Orchestrator
            </h1>
            <p className="text-[13px] text-[var(--text-3)] mt-3">
              What the orchestrator is doing right now, and the full lifecycle history below.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex gap-6 text-center">
              <div>
                <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--accent)" }}>{running}</div>
                <div className="eyebrow mt-1.5">Running</div>
              </div>
              <div>
                <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--warn)" }}>{review}</div>
                <div className="eyebrow mt-1.5">Review</div>
              </div>
              {blocked > 0 && (
                <div>
                  <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--down)" }}>{blocked}</div>
                  <div className="eyebrow mt-1.5">Blocked{needsYou > 0 ? ` · ${needsYou} need you` : ""}</div>
                </div>
              )}
              <div>
                <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--up)" }}>{done}</div>
                <div className="eyebrow mt-1.5">Done</div>
              </div>
            </div>
            <button
              type="button"
              onClick={manualRefresh}
              aria-label="Refresh"
              className="btn-ghost inline-flex items-center justify-center w-9 h-9"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Live — the orchestrator's current activity, updates every few seconds */}
        <div className="hq-rise mb-12" style={rise(1)}>
          <LiveOrchestrator />
        </div>

        {/* History — the full kanban lifecycle board, below the live view */}
        <section>
          {!loaded ? (
            <>
              <SectionHeader label="History" title="Every task, by lifecycle column" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
              </div>
            </>
          ) : (
            <KanbanBoard
              tasks={tasks}
              total={taskTotal}
              lastSync={taskSync}
              stale={historyStale}
              onActed={onActed}
              onOpen={(t) => setSelectedTaskId(t.id)}
            />
          )}
        </section>
      </div>
      {selectedTask && (
        <TaskDetailModal task={selectedTask} onClose={() => setSelectedTaskId(null)} />
      )}
    </>
  );
}
