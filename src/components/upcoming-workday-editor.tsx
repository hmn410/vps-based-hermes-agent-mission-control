"use client";

/* ───────────────────────────────────────────────────────────
   Hermy HQ · Upcoming Workday editor
   Manual, personal-only plan for the next workday. Saved via
   PUT /api/hermes/upcoming-workday; the bridge adds it to the
   morning brief on that date. One item per line.
   ─────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { Button, Eyebrow } from "@/components/ui/kit";

const field =
  "w-full bg-transparent text-[13px] text-[var(--text-2)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] resize-y";

interface Commitment { title: string; time?: string; location?: string; travelMinutes?: string; deadline?: string }
interface Saved {
  forDate?: string;
  fixedCommitments?: (Commitment | string)[];
  priorities?: string[];
  focusBlocks?: string[];
  risks?: string[];
  prepTonight?: string[];
  updatedAt?: string;
}

function nextWorkdayLocal(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(`${fmt.format(new Date())}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const join = (a?: string[]) => (a ?? []).join("\n");

function commitmentsToText(c?: (Commitment | string)[]) {
  return (c ?? [])
    .map((x) => (typeof x === "string" ? x : [x.title, x.time, x.location, x.travelMinutes, x.deadline].map((v) => v ?? "").join(" | ").replace(/( \| )+$/, "")))
    .join("\n");
}
function textToCommitments(s: string): Commitment[] {
  return lines(s).map((l) => {
    const [title, time, location, travelMinutes, deadline] = l.split("|").map((p) => p.trim());
    const c: Commitment = { title };
    if (time) c.time = time;
    if (location) c.location = location;
    if (travelMinutes) c.travelMinutes = travelMinutes;
    if (deadline) c.deadline = deadline;
    return c;
  });
}

export function UpcomingWorkdayEditor({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [forDate, setForDate] = useState(nextWorkdayLocal());
  const [commitments, setCommitments] = useState("");
  const [priorities, setPriorities] = useState("");
  const [focusBlocks, setFocusBlocks] = useState("");
  const [risks, setRisks] = useState("");
  const [prep, setPrep] = useState("");
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/hermes/upcoming-workday")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Saved) => {
        // Only prefill when the saved plan is for today or later (Chicago time).
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
        if (d?.forDate && d.forDate >= today) {
          setForDate(d.forDate);
          setCommitments(commitmentsToText(d.fixedCommitments));
          setPriorities(join(d.priorities));
          setFocusBlocks(join(d.focusBlocks));
          setRisks(join(d.risks));
          setPrep(join(d.prepTonight));
        }
      })
      .catch(() => {})
      .finally(() => setStatus("idle"));
  }, []);

  const save = async () => {
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/hermes/upcoming-workday", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forDate,
          fixedCommitments: textToCommitments(commitments),
          priorities: lines(priorities).slice(0, 3),
          focusBlocks: lines(focusBlocks),
          risks: lines(risks),
          prepTonight: lines(prep),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      setStatus("saved");
      onSaved?.();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const label = "block text-[11px] text-[var(--text-3)] mb-1";

  return (
    <div className="mt-4 rounded-[10px] border border-[var(--line)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-3.5 h-3.5 text-[var(--accent)]" />
          <Eyebrow className="!text-[9.5px]">Plan next workday</Eyebrow>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-[var(--text-3)] hover:text-[var(--text)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {status === "loading" ? (
        <p className="text-[13px] text-[var(--text-3)]">Loading…</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="uw-date">For date</label>
            <input id="uw-date" type="date" value={forDate} onChange={(e) => setForDate(e.target.value)} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="uw-commit">Fixed commitments — one per line: Title | time | location | travel | deadline</label>
            <textarea id="uw-commit" rows={3} value={commitments} onChange={(e) => setCommitments(e.target.value)} className={field}
              placeholder="Client call | 2:00pm | Zoom | 0 | send recap by 5pm" />
          </div>
          <div>
            <label className={label} htmlFor="uw-pri">Top 3 priorities</label>
            <textarea id="uw-pri" rows={3} value={priorities} onChange={(e) => setPriorities(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="uw-focus">Focus blocks</label>
            <textarea id="uw-focus" rows={3} value={focusBlocks} onChange={(e) => setFocusBlocks(e.target.value)} className={field} placeholder="9–11am deep work" />
          </div>
          <div>
            <label className={label} htmlFor="uw-risk">Risks / conflicts</label>
            <textarea id="uw-risk" rows={2} value={risks} onChange={(e) => setRisks(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="uw-prep">Prep tonight</label>
            <textarea id="uw-prep" rows={2} value={prep} onChange={(e) => setPrep(e.target.value)} className={field} />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-[var(--text-3)]">
              {status === "saved" ? "Saved. It will appear in that day's brief (hit Generate to see it now)."
                : status === "error" ? <span className="text-[var(--warn)]">{error}</span>
                : "Personal input only. Shown in the brief on the chosen weekday."}
            </p>
            <Button variant="primary" size="sm" onClick={save} disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Save plan"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
