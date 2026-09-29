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

// ── Types ─────────────────────────────────────────────────
interface KanbanTask {
  id: string;
  board: string;
  title: string;
  assignee: string | null;
  status: string;
  priority: number | null;
  result: string | null;
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

function normStatus(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}
function columnFor(status: string): Column {
  const k = normStatus(status);
  for (const c of COLUMN_ORDER) if (k.includes(c)) return c;
  if (k.includes("progress") || k.includes("doing")) return "running";
  if (k.includes("complete")) return "done";
  return "triage";
}
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

// ── Task detail modal — full title + full result, no truncation ──
function TaskDetailModal({ task, onClose }: { task: KanbanTask; onClose: () => void }) {
  const col = columnFor(task.status);
  const tone = columnTone(col);
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
              <Pill tone={tone}>{COLUMN_LABEL[col]}</Pill>
              {task.assignee && (
                <span className="num text-[10.5px] text-[var(--text-3)]">Worker: {task.assignee}</span>
              )}
              <span className="num text-[10.5px] text-[var(--text-4)]">{task.id}</span>
            </div>
            <p className="mt-2 text-[15px] font-medium text-[var(--text)] leading-snug">{task.title}</p>
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
function TaskCard({
  task,
  onActed,
  onOpen,
}: {
  task: KanbanTask;
  onActed: () => void;
  onOpen: (task: KanbanTask) => void;
}) {
  const col = columnFor(task.status);
  const tone = columnTone(col);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (
    e: React.MouseEvent,
    action: "unblock" | "archive" | "complete",
    confirmMsg?: string,
  ) => {
    e.stopPropagation();
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(action);
    try {
      const r = await fetch(`/api/hermes/tasks/${task.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (r.ok) onActed();
    } finally {
      setBusy(null);
    }
  };

  // Only surface actions that make sense to clear up from here — this is a
  // shortcut for common cleanup, not a full kanban board replacement.
  const showUnblock = col === "blocked";
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
        <Pill tone={tone}>{COLUMN_LABEL[col]}</Pill>
        {task.assignee && (
          <span className="num text-[10.5px] text-[var(--text-3)]">Worker: {task.assignee}</span>
        )}
        {task.priority != null && task.priority > 0 && (
          <span className="num text-[10.5px] text-[var(--text-3)] ml-auto">P{task.priority}</span>
        )}
      </div>
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
  onActed: () => void;
  onOpen: (task: KanbanTask) => void;
}) {
  const groups: Record<string, KanbanTask[]> = {};
  for (const t of tasks) {
    const col = columnFor(t.status);
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
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [historyStale, setHistoryStale] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const lastTasks = useRef<KanbanTask[]>([]);

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
      setTasks(snapshot.items);
      setHistoryStale(snapshot.stale);
      if (!snapshot.stale) {
        setTaskTotal(tk.total ?? tk.tasks?.length ?? 0);
        setTaskSync(tk.lastSync ?? null);
        setCounts(tk.counts ?? {});
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, [load]);

  const manualRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Kanban lifecycle counts (not the dispatch/approval bus — that's on /hermes).
  const countFor = (col: Column) =>
    Object.entries(counts).reduce(
      (sum, [status, n]) => (columnFor(status) === col ? sum + n : sum),
      0
    );
  const running = countFor("running");
  const blocked = countFor("blocked");
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
                  <div className="eyebrow mt-1.5">Blocked</div>
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
              onActed={load}
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
