"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader, Panel, Pill, EmptyState, Skeleton } from "@/components/ui/kit";
import { Cpu, Activity, ExternalLink } from "lucide-react";
import { keepLastKnownSnapshot } from "@/lib/task-snapshot";
import { activeTasks, activityForTask, describeExecutionEvent, type TelemetryHealth } from "@/lib/live-work";

const LIVE_REFRESH_MS = 1500;

interface LiveTask {
  id: string; title: string; assignee: string | null; status: string; priority: number | null;
  result: string | null; startedAt: string | null; completedAt: string | null; workerPid: number | null;
  workerStartedAt: string | null; lastHeartbeatAt: string | null; currentRunId: number | null;
  blockKind: string | null; currentStepKey: string | null; lastFailureError: string | null; syncedAt: string;
}
interface TaskEvent { id: number; taskId: string; runId: number | null; kind: string; payload: string | null; createdAt: string; title?: string; taskLabel?: string }

function ago(d: string | null): string {
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 5) return "just now"; if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function normStatus(s: string): string { return s.toLowerCase().replace(/[\s_-]+/g, ""); }
type Tone = "neutral" | "up" | "down" | "warn" | "accent";
const STATUS_LABEL: Record<string, string> = { triage: "Triage", todo: "To do", ready: "Ready", running: "Running", review: "Review", blocked: "Blocked" };
const STATUS_TONE: Record<string, Tone> = { triage: "neutral", todo: "neutral", ready: "accent", running: "accent", review: "warn", blocked: "down" };
function statusMeta(status: string): { label: string; tone: Tone } {
  const k = normStatus(status);
  for (const s of Object.keys(STATUS_LABEL)) if (k.includes(s)) return { label: STATUS_LABEL[s], tone: STATUS_TONE[s] };
  return { label: status, tone: "neutral" };
}
function parsePayload(raw: string | null): Record<string, unknown> { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
function formatEvent(e: TaskEvent): { icon: string; text: string; tone: Tone } {
  const p = parsePayload(e.payload);
  switch (e.kind) {
    case "created": return { icon: "＋", text: "Task created", tone: "neutral" };
    case "specified": return { icon: "✎", text: `Spec updated (${(p.changed_fields as string[] | undefined)?.join(", ") || "details"})`, tone: "neutral" };
    case "promoted": return { icon: "→", text: "Promoted to ready", tone: "accent" };
    case "claimed": return { icon: "◍", text: `Claimed · run #${p.run_id ?? e.runId ?? "?"}`, tone: "accent" };
    case "spawned": return { icon: "⚡", text: `Spawned worker${p.pid ? ` (pid ${p.pid})` : ""}`, tone: "accent" };
    case "heartbeat": return { icon: "♥", text: describeExecutionEvent("heartbeat", e.payload), tone: "accent" };
    case "completed": return { icon: "✓", text: p.summary ? `Completed — ${String(p.summary).slice(0, 140)}` : "Completed", tone: "up" };
    case "blocked": return { icon: "⛔", text: p.reason ? `Blocked (${p.kind || "blocker"}) — ${String(p.reason).slice(0, 140)}` : "Blocked", tone: "down" };
    case "block_loop_detected": return { icon: "⛔", text: p.reason ? `Still blocked — ${String(p.reason).slice(0, 140)}` : "Blocked again", tone: "down" };
    case "unblocked": return { icon: "↻", text: "Unblocked — resuming", tone: "accent" };
    case "gave_up": return { icon: "⚠", text: "Gave up after repeated blocks", tone: "down" };
    case "crashed": return { icon: "✕", text: `Worker crashed${p.error ? `: ${String(p.error).slice(0, 140)}` : ""}`, tone: "down" };
    case "status": return { icon: "•", text: (p.message as string) || "Status update", tone: "neutral" };
    default: return { icon: "•", text: e.kind, tone: "neutral" };
  }
}
function EventLine({ event, global = false }: { event: TaskEvent; global?: boolean }) {
  const f = formatEvent(event);
  return <div className="flex items-baseline gap-2 text-[11.5px]">
    <span className="w-4 shrink-0 text-center" style={{ color: `var(--${f.tone === "neutral" ? "text-3" : f.tone})` }}>{f.icon}</span>
    <span className="flex-1 min-w-0 text-[var(--text-2)] truncate">{global && <span className="text-[var(--text)]">{event.taskLabel ?? event.taskId}: </span>}{f.text}</span>
    <span className="num text-[var(--text-4)] shrink-0">{ago(event.createdAt)}</span>
  </div>;
}
function LiveTaskCard({ task, events, expanded, telemetryAvailable }: { task: LiveTask; events: TaskEvent[]; expanded: boolean; telemetryAvailable: boolean }) {
  const meta = statusMeta(task.status); const running = normStatus(task.status).includes("running");
  return <Panel className="p-4"><div className="flex items-start gap-3"><span className="relative flex w-2 h-2 mt-1.5 shrink-0">{running && <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }} />}<span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: `var(--${meta.tone === "neutral" ? "text-3" : meta.tone})` }} /></span><div className="flex-1 min-w-0">
    <p className="text-[13.5px] text-[var(--text)] leading-snug">{task.title}</p><p className="num text-[10.5px] text-[var(--text-4)] mt-1">{task.id}</p>
    <div className="flex items-center gap-2 flex-wrap mt-2"><Pill tone={meta.tone}>{meta.label}</Pill>{task.assignee && <span className="num text-[10.5px] text-[var(--text-3)]">Worker: {task.assignee}</span>}{task.currentRunId != null && <span className="num text-[10.5px] text-[var(--text-3)]">run #{task.currentRunId}</span>}{task.workerPid != null && <span className="num text-[10.5px] text-[var(--text-3)] inline-flex items-center gap-1"><Cpu className="w-3 h-3" />pid {task.workerPid}</span>}{task.lastHeartbeatAt && <span className="num text-[10.5px] text-[var(--text-3)]">♥ {ago(task.lastHeartbeatAt)}</span>}</div>
    {task.currentStepKey && <p className="mt-2.5 text-[11.5px] text-[var(--text-2)]">Current step: {task.currentStepKey}</p>}
    {(task.blockKind || task.lastFailureError) && <p className="mt-2 text-[11.5px] text-[var(--down)]">{task.blockKind ? `Blocker (${task.blockKind})` : "Failure"}: {task.lastFailureError || "Awaiting resolution"}</p>}
    {events.length ? <div className={`mt-3 border-t border-[var(--line)] pt-2.5 flex flex-col gap-1.5 overflow-y-auto pr-1 ${expanded ? "max-h-[260px]" : "max-h-[150px]"}`} aria-label={`Latest ${expanded ? 50 : 5} task events; scroll for more`}>{events.slice(0, expanded ? 50 : 5).map((e) => <EventLine key={e.id} event={e} />)}</div> : <p className={`mt-2.5 text-[11px] ${telemetryAvailable ? "text-[var(--text-4)]" : "text-[var(--down)]"}`}>{telemetryAvailable ? "No task events recorded yet" : "Execution telemetry unavailable"}</p>}
  </div></div></Panel>;
}
function TelemetryNotice({ telemetry }: { telemetry: TelemetryHealth | null }) {
  if (!telemetry) return <p className="text-[11px] text-[var(--warn)]">Execution telemetry has not been read yet.</p>;
  if (!telemetry.available) return <p className="text-[11px] text-[var(--down)]">Execution telemetry unavailable{telemetry.stale ? " or stale" : ""}. Last successful source read: {ago(telemetry.lastSuccessfulEventReadAt)}.{telemetry.error ? ` ${telemetry.error}` : ""}</p>;
  return <p className="text-[11px] text-[var(--text-3)]">Source read {ago(telemetry.lastSuccessfulEventReadAt)}{telemetry.newestEventId != null ? ` · newest event #${telemetry.newestEventId}` : ""} · heartbeats confirm the worker is alive; reported step/tool details appear inline.</p>;
}
export function LiveOrchestrator({ expanded = false }: { expanded?: boolean }) {
  const [tasks, setTasks] = useState<LiveTask[]>([]); const [events, setEvents] = useState<TaskEvent[]>([]); const [feed, setFeed] = useState<TaskEvent[]>([]); const [telemetry, setTelemetry] = useState<TelemetryHealth | null>(null); const [loaded, setLoaded] = useState(false); const [snapshotStale, setSnapshotStale] = useState(false); const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null); const [now, setNow] = useState(Date.now()); const lastTasks = useRef<LiveTask[]>([]);
  const load = useCallback(async () => { try { const r = await fetch("/api/hermes/tasks"); if (r.ok) { const d = await r.json(); const snapshot = keepLastKnownSnapshot(lastTasks.current, d.tasks ?? [], d.confirmedEmpty === true); lastTasks.current = snapshot.items; setTasks(snapshot.items); setSnapshotStale(snapshot.stale); if (!snapshot.stale) setEvents(Array.isArray(d.events) ? d.events : []); setFeed(Array.isArray(d.feed) ? d.feed : []); setTelemetry(d.telemetry ?? null); } } catch { /* keep last known data */ } finally { setLoaded(true); setNextRefreshAt(Date.now() + LIVE_REFRESH_MS); } }, []);
  useEffect(() => { load(); const iv = setInterval(load, LIVE_REFRESH_MS); const clock = setInterval(() => setNow(Date.now()), 250); return () => { clearInterval(iv); clearInterval(clock); }; }, [load]);
  const active = activeTasks(tasks).sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime()); const runningCount = tasks.filter((t) => normStatus(t.status).includes("running")).length; const refreshIn = nextRefreshAt == null ? null : Math.max(0, Math.ceil((nextRefreshAt - now) / 1000));
  return <div><SectionHeader label="Live" title="What the orchestrator is doing right now" action={<span className="inline-flex items-center gap-1.5 num text-[11px] text-[var(--text-3)]"><Activity className="w-3.5 h-3.5" style={{ color: runningCount ? "var(--accent)" : undefined }} />{snapshotStale ? "showing last successful task snapshot" : runningCount ? `${runningCount} running` : "idle"}{refreshIn != null ? ` · refresh ${refreshIn}s` : ""}</span>} />
    <div className="mb-4"><TelemetryNotice telemetry={telemetry} /></div>
    {!loaded ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div> : active.length === 0 ? <Panel className="p-2"><EmptyState icon={<Activity className="w-6 h-6" />} title="Nothing active right now" hint="Queued, running, or blocked tasks show up here as they move." /></Panel> : <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{active.map((t) => <LiveTaskCard key={t.id} task={t} events={activityForTask(events, t.id)} expanded={expanded} telemetryAvailable={telemetry?.available === true} />)}</div>}
    {expanded ? <section className="mt-10"><SectionHeader label="Execution history" title="Recent execution" /><TelemetryNotice telemetry={telemetry} />{telemetry?.available ? (feed.length ? <Panel className="mt-3 p-4"><div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1" aria-label="Recent execution events; scroll for more">{feed.map((event) => <EventLine key={event.id} event={event} global />)}</div></Panel> : <Panel className="mt-3 p-2"><EmptyState icon={<Activity className="w-6 h-6" />} title="No activity in retained history" hint="The event source is healthy; no execution events remain in retention." /></Panel>) : <Panel className="mt-3 p-4"><TelemetryNotice telemetry={telemetry} /></Panel>}</section> : <a href="/live-work" className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)]">View recent execution <ExternalLink className="w-3.5 h-3.5" /></a>}
  </div>;
}
