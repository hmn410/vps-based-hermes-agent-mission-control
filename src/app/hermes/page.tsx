"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  RefreshCw,
  Check,
  X,
  Pencil,
  Clock,
  Zap,
  Activity as ActivityIcon,
  Pause,
  Play,
} from "lucide-react";
import {
  Panel,
  SectionHeader,
  Button,
  Pill,
  EmptyState,
  Skeleton,
  Eyebrow,
} from "@/components/ui/kit";
import { HermesDispatches } from "@/components/hermes-dispatches";
import { FollowUpCard, type FollowUpTask } from "@/components/approval-inbox";
import cronstrue from "cronstrue";

// Hermes' cron list already returns human text for most schedules
// ("every monday 7:45am", "weekdays at 4:30pm", "once at ..."), but jobs
// created directly with raw cron syntax (e.g. "0,30 7-21 * * *") show up
// as unreadable numbers. Detect that shape and translate it to English;
// leave anything already human-readable untouched.
const RAW_CRON = /^\s*(\S+\s+){4}\S+\s*$/;
function humanizeSchedule(schedule: string): string {
  if (!schedule) return schedule;
  if (!RAW_CRON.test(schedule)) return schedule;
  try {
    return cronstrue.toString(schedule.trim(), { verbose: false, throwExceptionOnParseError: true });
  } catch {
    return schedule;
  }
}

// ── Types ─────────────────────────────────────────────────
type ReqStatus =
  | "queued"
  | "awaiting_approval"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "rejected";

interface Req {
  id: string;
  origin: string;
  kind: string;
  title: string;
  prompt: string | null;
  sideEffecting: boolean;
  status: ReqStatus;
  result: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type EvLevel = "info" | "up" | "warn" | "down";
interface Ev {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  agent: string | null;
  level: EvLevel;
  createdAt: string;
}

interface Health {
  online: boolean;
  gateway: string | null;
  detail: string | null;
  lastSeen: string | null;
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

// Like timeAgo but for a timestamp that may be in the future (e.g. a cron's next run).
function timeUntil(d: string | null): string {
  if (!d) return "—";
  const target = new Date(d).getTime();
  if (Number.isNaN(target)) return "—";
  const diff = target - Date.now();
  if (diff <= 0) return timeAgo(d);
  const s = Math.floor(diff / 1000);
  if (s < 45) return "in <1m";
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  const days = Math.floor(h / 24);
  return `in ${days}d`;
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

function levelColor(l: EvLevel): string {
  if (l === "up") return "var(--up)";
  if (l === "down") return "var(--down)";
  if (l === "warn") return "var(--warn)";
  return "var(--text-3)";
}

// ── Health chip ───────────────────────────────────────────
function HealthChip({ health }: { health: Health | null }) {
  const online = !!health?.online;
  const color = online ? "var(--up)" : "var(--warn)";
  return (
    <div
      className="flex items-center gap-2 rounded-full border px-3 py-1.5"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 22%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <span className="relative flex w-1.5 h-1.5">
        {online && (
          <span
            className="absolute inline-flex h-full w-full rounded-full animate-ping"
            style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }}
          />
        )}
        <span
          className="relative inline-flex w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
        />
      </span>
      <span className="text-[12px] font-semibold">
        {online ? "Online" : "Offline · bridge idle"}
      </span>
      {health?.lastSeen && (
        <span className="num text-[10.5px] text-[var(--text-3)]">
          {timeAgo(health.lastSeen)}
        </span>
      )}
    </div>
  );
}

// ── Dispatch bar ──────────────────────────────────────────
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
        flash(
          side
            ? "Sent to approval inbox — awaiting your go-ahead."
            : "Queued for Hermes."
        );
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
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
          }}
          placeholder="Ask or tell Hermes to do something…"
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
                background: side
                  ? "color-mix(in srgb, var(--warn) 55%, transparent)"
                  : "var(--surface-2)",
                border: "1px solid var(--line)",
              }}
            >
              <span
                className="absolute top-[1px] h-[14px] w-[14px] rounded-full bg-[var(--text)] transition-all"
                style={{ left: side ? "15px" : "1px" }}
              />
            </span>
            <span className="text-[12px] font-medium text-[var(--text-2)]">
              side-effecting?
            </span>
          </button>
          <Button variant="primary" onClick={submit} disabled={busy || !text.trim()}>
            <Send className="w-3.5 h-3.5" />
            Dispatch
          </Button>
        </div>
      </div>
      {toast && (
        <p className="mt-3 text-[12.5px] text-[var(--text-2)] flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" style={{ color: "var(--up)" }} />
          {toast}
        </p>
      )}
    </Panel>
  );
}

// ── Approval inbox card ───────────────────────────────────
function InboxCard({ req, onAction }: { req: Req; onAction: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(req.title);
  const [draftPrompt, setDraftPrompt] = useState(req.prompt ?? "");

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(`/api/hermes/requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onAction();
    } catch {
      /* leave card in place on failure */
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  return (
    <Panel className={`p-5 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone="neutral">{req.kind}</Pill>
          {req.sideEffecting && <Pill tone="warn">side-effecting</Pill>}
        </div>
        <span className="num text-[10.5px] text-[var(--text-3)] shrink-0 mt-1">
          {timeAgo(req.createdAt)}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2.5">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="w-full bg-transparent text-[14px] font-medium text-[var(--text)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
          />
          <textarea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            rows={3}
            className="w-full bg-transparent text-[13px] text-[var(--text-2)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] resize-y"
          />
        </div>
      ) : (
        <>
          <h3 className="text-[15px] font-medium text-[var(--text)] leading-snug">
            {req.title}
          </h3>
          {req.prompt && (
            <p className="mt-1.5 text-[13px] text-[var(--text-2)] leading-snug line-clamp-3">
              {req.prompt}
            </p>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mt-4">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() =>
                patch({ action: "edit", title: draftTitle.trim(), prompt: draftPrompt })
              }
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                color: "var(--accent)",
                border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              }}
            >
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftTitle(req.title);
                setDraftPrompt(req.prompt ?? "");
              }}
              className="btn-ghost inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => patch({ action: "approve" })}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                color: "var(--up)",
                border: "1px solid color-mix(in srgb, var(--up) 30%, transparent)",
                background: "color-mix(in srgb, var(--up) 10%, transparent)",
              }}
            >
              <Check className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => patch({ action: "reject" })}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors text-[var(--text-2)] hover:text-[var(--down)]"
              style={{ border: "1px solid var(--line)" }}
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors text-[var(--text-2)] hover:text-[var(--text)]"
              style={{ border: "1px solid var(--line)" }}
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}


// Kanban task parked on a human (blocked / repeat-blocked). Distinct from an
// approval request: this work already started; the worker needs an answer.
type BlockedOnYou = {
  id: string; title: string; label?: string; attentionKind?: string;
  reason: string | null; recurrences?: number; blockedAt?: string | null; updatedAt: string;
};
function BlockedOnYouCard({ task }: { task: BlockedOnYou }) {
  return (
    <Panel className="p-5" style={{ borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone="down">{task.attentionKind === "repeat_block" ? "Blocked again" : "Blocked on you"}</Pill>
          {task.label && <Pill tone="neutral">{task.label}</Pill>}
        </div>
        <span className="num text-[10.5px] text-[var(--text-3)] shrink-0 mt-1">{timeAgo(task.blockedAt || task.updatedAt)}</span>
      </div>
      <h3 className="text-[15px] font-medium text-[var(--text)] leading-snug">{task.title}</h3>
      {task.reason && <p className="mt-1.5 text-[13px] text-[var(--text-2)] leading-snug line-clamp-4 whitespace-pre-wrap">{task.reason}</p>}
      <a href={`/tasks?task=${encodeURIComponent(task.id)}`} className="mt-3 inline-flex text-[12px] text-[var(--accent)]">Open on task board →</a>
    </Panel>
  );
}

// ── Cron / schedules ──────────────────────────────────────
type CronJob = {
  id: string; status: string; name: string; schedule: string;
  nextRun: string | null; lastRun: string | null; lastResult: string | null;
  deliver: string | null; skills: string | null; script: string | null; mode: string | null;
};
function CronPanel({ jobs, syncedAt, onDone }: { jobs: CronJob[]; syncedAt: string | null; onDone: () => void }) {
  const [schedule, setSchedule] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runName, setRunName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/hermes/crons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setNote(r.ok ? ok : "Request failed.");
      if (r.ok) onDone();
    } catch {
      setNote("Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    if (!schedule.trim() || !prompt.trim()) return;
    post(
      { op: "create", schedule: schedule.trim(), prompt: prompt.trim() },
      "Schedule sent to Hermes."
    ).then(() => {
      setSchedule("");
      setPrompt("");
    });
  };
  const runNow = () => {
    if (!runName.trim()) return;
    post({ op: "run", name: runName.trim() }, "Run-now sent to Hermes.").then(() =>
      setRunName("")
    );
  };

  return (
    <>
      <SectionHeader
        label="Cron · schedules"
        title="Recurring jobs"
        action={
          <span className="flex items-center gap-2">
            <span className="num text-[11px] text-[var(--text-3)]">
              synced {timeAgo(syncedAt)}
            </span>
            <button
              type="button"
              onClick={onDone}
              title="Refresh now"
              aria-label="Refresh schedules"
              className="btn-ghost p-1.5 rounded-full"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </span>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Schedules */}
        <Panel className="p-5">
          <div className="flex items-center justify-between mb-3">
            <Eyebrow>schedules</Eyebrow>
            <span className="num text-[10.5px] text-[var(--text-3)]">
              {jobs.length} job{jobs.length === 1 ? "" : "s"}
            </span>
          </div>
          {jobs.length === 0 ? (
            <p className="text-[13px] text-[var(--text-3)] py-6 text-center">
              No schedules yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-[440px] overflow-auto -mx-1 px-1">
              {jobs.map((j) => {
                const active = j.status === "active";
                return (
                  <div key={j.id} className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: active ? "var(--up)" : "var(--text-3)" }} title={j.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[var(--text)] truncate">{j.name || j.id}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 num text-[11px] text-[var(--text-3)]">
                          <span className="text-[var(--text-2)]">{humanizeSchedule(j.schedule)}</span>
                          {j.nextRun && <span>next {timeUntil(j.nextRun)}</span>}
                          {j.deliver && <span>→ {j.deliver.split(":")[0]}</span>}
                          {j.skills && <span>{j.skills}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button title="Run now" disabled={busy} onClick={() => post({ op: "run", id: j.id, name: j.name }, "Run-now sent.")} className="p-1.5 rounded-md text-[var(--text-3)] hover:text-[var(--accent)] hover:bg-[var(--surface-1)] transition-colors">
                          <Zap className="w-3.5 h-3.5" />
                        </button>
                        {active ? (
                          <button title="Pause" disabled={busy} onClick={() => post({ op: "pause", id: j.id, name: j.name }, "Pause sent.")} className="p-1.5 rounded-md text-[var(--text-3)] hover:text-[var(--warn)] hover:bg-[var(--surface-1)] transition-colors">
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button title="Resume" disabled={busy} onClick={() => post({ op: "resume", id: j.id, name: j.name }, "Resume sent.")} className="p-1.5 rounded-md text-[var(--text-3)] hover:text-[var(--up)] hover:bg-[var(--surface-1)] transition-colors">
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Controls */}
        <Panel className="p-5">
          <div className="space-y-4">
            <div>
              <Eyebrow className="!mb-2 block">New schedule</Eyebrow>
              <div className="space-y-2.5">
                <input
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder={'Schedule — plain English works, e.g. "every monday 7:45am" or "weekdays at 4:30pm"'}
                  className="w-full bg-transparent num text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
                />
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={2}
                  placeholder="Prompt — what should Hermes do on this cadence?"
                  className="w-full bg-transparent text-[13px] text-[var(--text-2)] placeholder:text-[var(--text-3)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] resize-y"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={create}
                  disabled={busy || !schedule.trim() || !prompt.trim()}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Create schedule
                </Button>
              </div>
            </div>

            <div className="rule" />

            <div>
              <Eyebrow className="!mb-2 block">Run now</Eyebrow>
              <div className="flex items-center gap-2.5">
                <input
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runNow(); } }}
                  placeholder="Job name"
                  className="flex-1 min-w-0 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
                />
                <Button variant="ghost" size="sm" onClick={runNow} disabled={busy || !runName.trim()}>
                  <Zap className="w-3.5 h-3.5" />
                  Run now
                </Button>
              </div>
            </div>

            {note && (
              <p className="text-[12px] text-[var(--text-2)] flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" style={{ color: "var(--up)" }} />
                {note}
              </p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

// ── Activity feed ─────────────────────────────────────────
const ACTIVITY_PAGE_SIZE = 10;
function ActivityFeed({ events }: { events: Ev[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(events.length / ACTIVITY_PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageEvents = events.slice(clampedPage * ACTIVITY_PAGE_SIZE, clampedPage * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE);
  return (
    <>
      <SectionHeader
        label="Activity"
        title="Recent events"
        action={
          events.length > 0 ? (
            <span className="num text-[11px] text-[var(--text-3)]">{events.length} total</span>
          ) : undefined
        }
      />
      {events.length === 0 ? (
        <Panel className="p-2">
          <EmptyState
            icon={<ActivityIcon className="w-6 h-6" />}
            title="No recent activity"
            hint="Events from Hermes and its agents will stream in here."
          />
        </Panel>
      ) : (
        <>
          <Panel className="p-2">
            <div className="divide-y divide-[var(--line)]">
              {pageEvents.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-3.5 py-3">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: levelColor(e.level) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-[var(--text)] leading-snug truncate">
                        {e.title}
                      </p>
                      <span className="num text-[10.5px] text-[var(--text-3)] shrink-0 ml-auto">
                        {timeAgo(e.createdAt)}
                      </span>
                    </div>
                    {e.detail && (
                      <p className="mt-0.5 text-[12.5px] text-[var(--text-2)] leading-snug line-clamp-2">
                        {e.detail}
                      </p>
                    )}
                    {e.agent && (
                      <span className="num text-[10.5px] text-[var(--text-3)] mt-1 inline-block">
                        {e.agent}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-3 px-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                className="btn-ghost inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="num text-[11px] text-[var(--text-3)]">
                Page {clampedPage + 1} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={clampedPage >= pageCount - 1}
                className="btn-ghost inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function HermesPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [inbox, setInbox] = useState<Req[]>([]);
  const [blockedOnYou, setBlockedOnYou] = useState<BlockedOnYou[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpTask[]>([]);
  const [pending, setPending] = useState(0);
  const [events, setEvents] = useState<Ev[]>([]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [cronSync, setCronSync] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [h, reqs, act, cr] = await Promise.all([
      getJSON<Health>("/api/hermes/health"),
      getJSON<{ requests: Req[]; pending: number; blockedTasks?: BlockedOnYou[]; followUpTasks?: FollowUpTask[] }>(
        "/api/hermes/requests?status=awaiting_approval&take=50"
      ),
      getJSON<{ events: Ev[] }>("/api/hermes/activity?take=30"),
      getJSON<{ jobs: CronJob[]; syncedAt: string }>("/api/hermes/crons"),
    ]);
    if (h) setHealth(h);
    if (reqs) {
      setInbox(reqs.requests ?? []);
      setBlockedOnYou(reqs.blockedTasks ?? []);
      setFollowUps(reqs.followUpTasks ?? []);
      setPending(reqs.pending ?? reqs.requests?.length ?? 0);
    }
    if (act) setEvents(act.events ?? []);

    if (cr) {
      setJobs(cr.jobs ?? []);
      setCronSync(cr.syncedAt ?? null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const iv = setInterval(load, 8000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(iv);
    };
  }, [load]);

  const manualRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <>
      <div className="relative z-10 w-full mx-auto pb-16">
        {/* Header */}
        <div className="hq-rise pt-4 pb-8 flex items-end justify-between gap-4">
          <div>
            <Eyebrow>Agent runtime</Eyebrow>
            <h1 className="mt-2.5 text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
              Hermes
            </h1>
          </div>
          <div className="flex items-center gap-2.5">
            <HealthChip health={health} />
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

        {/* Dispatch */}
        <div className="hq-rise">
          <DispatchBar onDone={load} />
        </div>

        {/* Dispatches — what you've sent Hermes + live status/results */}
        <section className="mt-12">
          <HermesDispatches />
        </section>

        {/* Approval inbox */}
        <section className="mt-12">
          <SectionHeader
            label="Approval inbox"
            title="Needs you: approvals and blocked tasks"
            action={
              pending > 0 ? (
                <Pill tone="warn">{pending} pending</Pill>
              ) : (
                <span className="num text-[11px] text-[var(--text-3)]">clear</span>
              )
            }
          />
          {!loaded ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : inbox.length === 0 && blockedOnYou.length === 0 && followUps.length === 0 ? (
            <p className="px-1 text-[12.5px] text-[var(--text-3)]">
              Clear — side-effecting dashboard requests appear here before Hermes acts on them.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {inbox.map((req) => (
                <InboxCard key={req.id} req={req} onAction={load} />
              ))}
              {blockedOnYou.map((task) => (
                <BlockedOnYouCard key={task.id} task={task} />
              ))}
              {followUps.map((task) => (
                <FollowUpCard key={task.id} task={task} compact={false} />
              ))}
            </div>
          )}
        </section>


        {/* Cron / schedules */}
        <section className="mt-12">
          {!loaded ? (
            <>
              <SectionHeader label="Cron · schedules" title="Recurring jobs" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Skeleton className="h-56" />
                <Skeleton className="h-56" />
              </div>
            </>
          ) : (
            <CronPanel jobs={jobs} syncedAt={cronSync} onDone={load} />
          )}
        </section>

        {/* Activity feed */}
        <section className="mt-12">
          {!loaded ? (
            <>
              <SectionHeader label="Activity" title="Recent events" />
              <Skeleton className="h-64" />
            </>
          ) : (
            <ActivityFeed events={events} />
          )}
        </section>

      </div>
    </>
  );
}
