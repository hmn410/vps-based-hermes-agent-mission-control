"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, RefreshCw, LayoutGrid } from "lucide-react";
import {
  Panel,
  SectionHeader,
  Button,
  Pill,
  EmptyState,
  Skeleton,
  Eyebrow,
  rise,
} from "@/components/ui/kit";
import { HermesDispatches } from "@/components/hermes-dispatches";
import { LiveOrchestrator } from "@/components/live-orchestrator";

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

interface Req {
  status: string;
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
    const r = await fetch(url);
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

// ── Quick dispatch bar — send new work into the orchestrator ──
function DispatchBar({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [side, setSide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const submit = async () => {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/hermes/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "oneshot", title, sideEffecting: side }),
      });
      if (r.ok) {
        setText("");
        flash(side ? "Sent to approval inbox — awaiting your go-ahead." : "Queued for Hermes.");
        onDone();
      } else {
        flash("Dispatch failed. Try again.");
      }
    } catch {
      flash("Dispatch failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="Send a new task to the orchestrator…"
          className="flex-1 min-w-0 bg-transparent text-[14px] text-[var(--text)] placeholder:text-[var(--text-3)] px-3.5 py-2.5 rounded-[10px] border border-[var(--line)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] outline-none transition-colors"
        />
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setSide((s) => !s)}
            aria-pressed={side}
            className="flex items-center gap-2 select-none"
          >
            <span
              className="relative inline-flex h-[18px] w-[32px] rounded-full transition-colors"
              style={{
                background: side ? "color-mix(in srgb, var(--warn) 55%, transparent)" : "var(--surface-2)",
                border: "1px solid var(--line)",
              }}
            >
              <span
                className="absolute top-[1px] h-[14px] w-[14px] rounded-full bg-[var(--text)] transition-all"
                style={{ left: side ? "15px" : "1px" }}
              />
            </span>
            <span className="text-[12px] font-medium text-[var(--text-2)]">side-effecting?</span>
          </button>
          <Button variant="primary" onClick={submit} disabled={busy || !text.trim()}>
            <Send className="w-3.5 h-3.5" />
            Dispatch
          </Button>
        </div>
      </div>
      {toast && <p className="mt-3 text-[12.5px] text-[var(--text-2)]">{toast}</p>}
    </Panel>
  );
}

// ── Kanban task card ──────────────────────────────────────
function TaskCard({ task }: { task: KanbanTask }) {
  const col = columnFor(task.status);
  const tone = columnTone(col);
  return (
    <div
      className="panel p-3.5"
      style={{
        borderLeft: `2px solid color-mix(in srgb, ${toneVar(tone)} 55%, transparent)`,
      }}
    >
      <p className="text-[13px] text-[var(--text)] leading-snug line-clamp-3">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap mt-2.5">
        <Pill tone={tone}>{COLUMN_LABEL[col]}</Pill>
        {task.assignee && (
          <span className="num text-[10.5px] text-[var(--text-3)]">→ {task.assignee}</span>
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
    </div>
  );
}

// ── Kanban orchestrator board ─────────────────────────────
function OrchestratorBoard({
  tasks,
  total,
  lastSync,
}: {
  tasks: KanbanTask[];
  total: number;
  lastSync: string | null;
}) {
  const groups: Record<string, KanbanTask[]> = {};
  for (const t of tasks) {
    const col = columnFor(t.status);
    (groups[col] ||= []).push(t);
  }

  return (
    <>
      <SectionHeader
        label="Kanban board"
        title="Every task, by lifecycle column"
        action={
          <div className="flex items-center gap-3">
            <span className="num text-[12px] text-[var(--text-2)]">{total} total</span>
            <span className="num text-[11px] text-[var(--text-3)]">synced {timeAgo(lastSync)}</span>
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
                    items.map((t) => <TaskCard key={t.id} task={t} />)
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
export default function TasksPage() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskSync, setTaskSync] = useState<string | null>(null);
  const [pipelineCounts, setPipelineCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [tk, reqs] = await Promise.all([
      getJSON<{ tasks: KanbanTask[]; counts: Record<string, number>; total: number; lastSync: string }>(
        "/api/hermes/tasks"
      ),
      getJSON<{ requests: Req[] }>("/api/hermes/requests?take=100"),
    ]);
    if (tk) {
      setTasks(tk.tasks ?? []);
      setTaskTotal(tk.total ?? tk.tasks?.length ?? 0);
      setTaskSync(tk.lastSync ?? null);
    }
    if (reqs) {
      const counts: Record<string, number> = {};
      for (const r of reqs.requests ?? []) counts[r.status] = (counts[r.status] || 0) + 1;
      setPipelineCounts(counts);
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

  const queued = pipelineCounts.queued || 0;
  const running = pipelineCounts.running || 0;
  const awaiting = pipelineCounts.awaiting_approval || 0;
  const done = pipelineCounts.done || 0;
  const failed = pipelineCounts.failed || 0;

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
              Where every task is sent, who it&apos;s assigned to, and how it&apos;s running.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex gap-6 text-center">
              <div>
                <div className="num text-[20px] font-semibold leading-none text-[var(--text-2)]">{queued}</div>
                <div className="eyebrow mt-1.5">Queued</div>
              </div>
              <div>
                <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--accent)" }}>{running}</div>
                <div className="eyebrow mt-1.5">Running</div>
              </div>
              <div>
                <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--warn)" }}>{awaiting}</div>
                <div className="eyebrow mt-1.5">Awaiting</div>
              </div>
              <div>
                <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--up)" }}>{done}</div>
                <div className="eyebrow mt-1.5">Done</div>
              </div>
              {failed > 0 && (
                <div>
                  <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--down)" }}>{failed}</div>
                  <div className="eyebrow mt-1.5">Failed</div>
                </div>
              )}
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

        {/* Dispatch */}
        <div className="hq-rise mb-12" style={rise(2)}>
          <DispatchBar onDone={load} />
        </div>

        {/* History — everything already sent + the full kanban lifecycle board */}
        <div className="hq-rise mb-3" style={rise(3)}>
          <Eyebrow>History</Eyebrow>
          <h2 className="mt-1.5 text-[15px] font-medium text-[var(--text-2)]">Past runs and the full board</h2>
        </div>

        <section className="mb-12">
          <HermesDispatches />
        </section>

        <section>
          {!loaded ? (
            <>
              <SectionHeader label="Kanban board" title="Every task, by lifecycle column" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
              </div>
            </>
          ) : (
            <OrchestratorBoard tasks={tasks} total={taskTotal} lastSync={taskSync} />
          )}
        </section>
      </div>
    </>
  );
}
