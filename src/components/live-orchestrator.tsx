"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader, Panel, Pill, EmptyState, Skeleton } from "@/components/ui/kit";
import { Cpu, Activity } from "lucide-react";
import { keepLastKnownSnapshot } from "@/lib/task-snapshot";

// ── Types (mirrors HermesTask / HermesTaskEvent from the API) ───────
interface LiveTask {
  id: string;
  title: string;
  assignee: string | null;
  status: string;
  priority: number | null;
  result: string | null;
  startedAt: string | null;
  completedAt: string | null;
  workerPid: number | null;
  workerStartedAt: string | null;
  lastHeartbeatAt: string | null;
  currentRunId: number | null;
  blockKind: string | null;
  currentStepKey: string | null;
  syncedAt: string;
}
interface TaskEvent {
  id: number;
  taskId: string;
  runId: number | null;
  kind: string;
  payload: string | null;
  createdAt: string;
}

function ago(d: string | null): string {
  if (!d) return "";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function normStatus(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}
function isActive(status: string): boolean {
  const k = normStatus(status);
  if (k.includes("done") || k.includes("archiv") || k.includes("complete")) return false;
  return true;
}
type Tone = "neutral" | "up" | "down" | "warn" | "accent";
const STATUS_LABEL: Record<string, string> = {
  triage: "Triage", todo: "To do", ready: "Ready", running: "Running",
  review: "Review", blocked: "Blocked",
};
const STATUS_TONE: Record<string, Tone> = {
  triage: "neutral", todo: "neutral", ready: "accent", running: "accent",
  review: "warn", blocked: "down",
};
function statusMeta(status: string): { label: string; tone: Tone } {
  const k = normStatus(status);
  for (const s of Object.keys(STATUS_LABEL)) if (k.includes(s)) return { label: STATUS_LABEL[s], tone: STATUS_TONE[s] };
  return { label: status, tone: "neutral" };
}

// ── Event → human line ───────────────────────────────────────────
// Kanban events are the actual dispatcher/worker lifecycle: created, specified,
// promoted, claimed, spawned, heartbeat, commented, completed, blocked,
// unblocked, gave_up, crashed, block_loop_detected, status.
function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
function formatEvent(e: TaskEvent): { icon: string; text: string; tone: Tone } {
  const p = parsePayload(e.payload);
  switch (e.kind) {
    case "created":
      return { icon: "＋", text: "Task created", tone: "neutral" };
    case "specified":
      return { icon: "✎", text: `Spec updated (${(p.changed_fields as string[] | undefined)?.join(", ") || "details"})`, tone: "neutral" };
    case "promoted":
      return { icon: "→", text: "Promoted to ready", tone: "accent" };
    case "claimed":
      return { icon: "◍", text: `Claimed · run #${p.run_id ?? e.runId ?? "?"}`, tone: "accent" };
    case "spawned":
      return { icon: "⚡", text: `Spawned worker${p.pid ? ` (pid ${p.pid})` : ""}`, tone: "accent" };
    case "heartbeat":
      return { icon: "♥", text: "Heartbeat — still working", tone: "accent" };
    case "commented": {
      const author = (p.author as string) || "agent";
      return { icon: "💬", text: `Comment from ${author}${p.len ? ` (${p.len} chars)` : ""}`, tone: "neutral" };
    }
    case "completed":
      return { icon: "✓", text: (p.summary as string) ? `Completed — ${(p.summary as string).slice(0, 140)}` : "Completed", tone: "up" };
    case "blocked":
      return { icon: "⛔", text: (p.reason as string) ? `Blocked (${p.kind || "blocker"}) — ${(p.reason as string).slice(0, 140)}` : "Blocked", tone: "down" };
    case "block_loop_detected":
      return { icon: "⛔", text: (p.reason as string) ? `Still blocked — ${(p.reason as string).slice(0, 140)}` : "Blocked again", tone: "down" };
    case "unblocked":
      return { icon: "↻", text: "Unblocked — resuming", tone: "accent" };
    case "gave_up":
      return { icon: "⚠", text: "Gave up after repeated blocks", tone: "down" };
    case "crashed":
      return { icon: "✕", text: `Worker crashed${p.error ? `: ${String(p.error).slice(0, 140)}` : ""}`, tone: "down" };
    case "status":
      return { icon: "•", text: (p.message as string) || "Status update", tone: "neutral" };
    default:
      return { icon: "•", text: e.kind, tone: "neutral" };
  }
}

// ── Single live task card, with its own recent event timeline ───────
function LiveTaskCard({ task, events }: { task: LiveTask; events: TaskEvent[] }) {
  const meta = statusMeta(task.status);
  const running = normStatus(task.status).includes("running");
  const latest = events[0];


  return (
    <Panel className="p-4">
      <div className="flex items-start gap-3">
        <span className="relative flex w-2 h-2 mt-1.5 shrink-0">
          {running && (
            <span
              className="absolute inline-flex h-full w-full rounded-full animate-ping"
              style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }}
            />
          )}
          <span
            className="relative inline-flex w-2 h-2 rounded-full"
            style={{ background: `var(--${meta.tone === "neutral" ? "text-3" : meta.tone})` }}
          />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13.5px] text-[var(--text)] leading-snug">{task.title}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <Pill tone={meta.tone}>{meta.label}</Pill>
            {task.assignee && <span className="num text-[10.5px] text-[var(--text-3)]">Worker: {task.assignee}</span>}
            {task.currentRunId != null && (
              <span className="num text-[10.5px] text-[var(--text-3)]">run #{task.currentRunId}</span>
            )}
            {task.workerPid != null && (
              <span className="num text-[10.5px] text-[var(--text-3)] inline-flex items-center gap-1">
                <Cpu className="w-3 h-3" /> pid {task.workerPid}
              </span>
            )}
            {task.lastHeartbeatAt && (
              <span className="num text-[10.5px] text-[var(--text-3)]">
                ♥ {ago(task.lastHeartbeatAt)}
              </span>
            )}
          </div>

          {/* Live event timeline — most recent first, last 5 */}
          {events.length > 0 ? (
            <div className="mt-3 border-t border-[var(--line)] pt-2.5 flex flex-col gap-1.5">
              {events.slice(0, 5).map((e) => {
                const f = formatEvent(e);
                return (
                  <div key={e.id} className="flex items-baseline gap-2 text-[11.5px]">
                    <span className="w-4 shrink-0 text-center" style={{ color: `var(--${f.tone === "neutral" ? "text-3" : f.tone})` }}>
                      {f.icon}
                    </span>
                    <span className="flex-1 min-w-0 text-[var(--text-2)] truncate">{f.text}</span>
                    <span className="num text-[var(--text-4)] shrink-0">{ago(e.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            latest === undefined && (
              <p className="mt-2.5 text-[11px] text-[var(--text-4)]">No activity recorded yet</p>
            )
          )}
        </div>
      </div>
    </Panel>
  );
}

// ── Main live orchestrator panel ─────────────────────────────────
export function LiveOrchestrator() {
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [snapshotStale, setSnapshotStale] = useState(false);
  const lastTasks = useRef<LiveTask[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hermes/tasks");
      if (r.ok) {
        const d = await r.json();
        const snapshot = keepLastKnownSnapshot(lastTasks.current, d.tasks ?? [], d.confirmedEmpty === true);
        lastTasks.current = snapshot.items;
        setTasks(snapshot.items);
        setSnapshotStale(snapshot.stale);
        if (!snapshot.stale && Array.isArray(d.events)) setEvents(d.events);
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 3000); // fast poll — this panel is meant to feel live
    return () => clearInterval(iv);
  }, [load]);

  const active = tasks.filter((t) => isActive(t.status));
  // Running first, then review/blocked, then ready/todo/triage; within each, most recently touched first.
  const rank = (t: LiveTask) => {
    const k = normStatus(t.status);
    if (k.includes("running")) return 0;
    if (k.includes("review")) return 1;
    if (k.includes("blocked")) return 2;
    if (k.includes("ready")) return 3;
    return 4;
  };
  active.sort((a, b) => rank(a) - rank(b) || new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime());

  const eventsByTask: Record<string, TaskEvent[]> = {};
  for (const e of events) (eventsByTask[e.taskId] ||= []).push(e);

  const runningCount = tasks.filter((t) => normStatus(t.status).includes("running")).length;

  return (
    <div>
      <SectionHeader
        label="Live"
        title="What the orchestrator is doing right now"
        action={
          <span className="inline-flex items-center gap-1.5 num text-[11px] text-[var(--text-3)]">
            <Activity className="w-3.5 h-3.5" style={{ color: runningCount > 0 ? "var(--accent)" : undefined }} />
            {snapshotStale ? "showing last successful snapshot" : runningCount > 0 ? `${runningCount} running` : "idle"}
          </span>
        }
      />
      {!loaded ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : active.length === 0 ? (
        <Panel className="p-2">
          <EmptyState
            icon={<Activity className="w-6 h-6" />}
            title="Nothing active right now"
            hint="Queued, running, or blocked tasks — and their live subagent/worker events — show up here the moment they move."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {active.map((t) => (
            <LiveTaskCard key={t.id} task={t} events={eventsByTask[t.id] || []} />
          ))}
        </div>
      )}
    </div>
  );
}
