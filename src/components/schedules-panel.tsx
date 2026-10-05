"use client";

/* Recurring Hermes jobs (cron): list + run/pause/resume + create. Personal
   jobs are actionable; system plumbing (kanban-*, local delivery) and
   work-related jobs are hidden behind "Show system & hidden jobs" and are
   read-only here AND server-side (POST /api/hermes/crons returns 403 for
   them — see src/lib/cron-visibility.ts). Every mutation is queued as an
   AgentRequest that waits in the Approval Inbox. */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check, Clock, Zap, Pause, Play } from "lucide-react";
import { Panel, SectionHeader, Button, Skeleton, Eyebrow } from "@/components/ui/kit";
import { classifyCronJob, type CronVisibility } from "@/lib/cron-visibility";
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

// ── Cron / schedules ──────────────────────────────────────
type CronJob = {
  id: string; status: string; name: string; schedule: string;
  nextRun: string | null; lastRun: string | null; lastResult: string | null;
  deliver: string | null; skills: string | null; script: string | null; mode: string | null;
  visibility?: CronVisibility;
};
const VISIBILITY_LABEL: Record<Exclude<CronVisibility, "personal">, string> = {
  system: "system · read-only",
  work: "work · hidden · read-only",
};
function CronPanel({ jobs, syncedAt, onDone }: { jobs: CronJob[]; syncedAt: string | null; onDone: () => void }) {
  const [schedule, setSchedule] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runName, setRunName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // System plumbing (kanban-*, local delivery) and work-related jobs are
  // hidden by default and never actionable here (src/lib/cron-visibility.ts).
  const [showHidden, setShowHidden] = useState(false);
  const tagged = jobs.map((j) => ({ ...j, visibility: j.visibility ?? classifyCronJob(j) }));
  const hiddenCount = tagged.filter((j) => j.visibility !== "personal").length;
  const shown = showHidden ? tagged : tagged.filter((j) => j.visibility === "personal");

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
              {shown.length} job{shown.length === 1 ? "" : "s"}
              {!showHidden && hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            </span>
          </div>
          {hiddenCount > 0 && (
            <label className="mb-3 flex items-center gap-2 text-[12px] text-[var(--text-2)] select-none cursor-pointer">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Show system &amp; hidden jobs
              <span className="text-[11px] text-[var(--text-3)]">(read-only)</span>
            </label>
          )}
          {shown.length === 0 ? (
            <p className="text-[13px] text-[var(--text-3)] py-6 text-center">
              {jobs.length === 0 ? "No schedules yet." : "No personal schedules."}
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-[440px] overflow-auto -mx-1 px-1">
              {shown.map((j) => {
                const active = j.status === "active" || j.status === "scheduled";
                const readOnly = j.visibility !== "personal";
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
                          {readOnly && <span className="text-[var(--text-4)]">{VISIBILITY_LABEL[j.visibility as Exclude<CronVisibility, "personal">]}</span>}
                        </div>
                      </div>
                      {!readOnly && (
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
                      )}
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

export function SchedulesPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hermes/crons", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { jobs?: CronJob[]; syncedAt?: string | null };
        setJobs(d.jobs ?? []);
        setSyncedAt(d.syncedAt ?? null);
      }
    } catch {
      /* keep last known list */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const iv = window.setInterval(load, 15000);
    return () => { window.clearTimeout(first); window.clearInterval(iv); };
  }, [load]);

  if (!loaded) {
    return (
      <>
        <SectionHeader label="Cron · schedules" title="Recurring jobs" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </>
    );
  }
  return <CronPanel jobs={jobs} syncedAt={syncedAt} onDone={load} />;
}
