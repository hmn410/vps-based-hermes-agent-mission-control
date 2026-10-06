"use client";

/* ─────────────────────────────────────────────────────────
   Human-action handoff panel ("what exactly do I do?").
   Loads GET /api/hermes/tasks/:id/handoff — built from the FULL
   kanban task detail, not truncated previews — and renders:
   why · exact commands (copyable) / UI steps · where · expected ·
   what happens after. Display only: nothing here runs a command.
   When the worker recorded no exact steps, says so explicitly.
   ───────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import { Copy, ClipboardCheck, ChevronDown, ChevronRight, TerminalSquare, AlertTriangle } from "lucide-react";
import type { TaskHandoff } from "@/lib/task-handoff";

type HandoffResponse = {
  available: boolean;
  taskId?: string;
  error?: string;
  handoff?: TaskHandoff;
};

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
      }}
      className="btn-ghost inline-flex items-center gap-1 px-2 py-0.5 text-[11px]"
      aria-label={`${label} command`}
    >
      {copied ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function Field({ label, value, absent }: { label: string; value: string | null; absent: string }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)]">{label}</p>
      {value ? (
        <p className="mt-0.5 text-[12.5px] text-[var(--text-2)] leading-snug whitespace-pre-wrap break-words">{value}</p>
      ) : (
        <p className="mt-0.5 text-[12px] italic text-[var(--text-3)]">{absent}</p>
      )}
    </div>
  );
}

export function HandoffBody({ handoff, taskId }: { handoff: TaskHandoff; taskId: string }) {
  const [showSources, setShowSources] = useState(false);
  const allCommands = handoff.commands.map((c) => c.code).join("\n\n");
  return (
    <div className="space-y-3">
      <Field label="Why you're needed" value={handoff.why} absent="The worker did not record a reason." />

      {handoff.state === "absent" ? (
        <div
          className="rounded-[8px] px-3 py-2.5 text-[12.5px] leading-snug"
          style={{ color: "var(--warn)", border: "1px solid color-mix(in srgb, var(--warn) 35%, transparent)", background: "color-mix(in srgb, var(--warn) 7%, transparent)" }}
          role="note"
        >
          <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> No exact commands or steps were recorded</p>
          <p className="mt-1 text-[var(--text-2)]">
            HQ will not guess. Read the reason and comments below, or ask the worker for an exact handoff:
            comment on task <span className="num">{taskId}</span> asking for the commands, where to run them, and the expected result.
          </p>
        </div>
      ) : (
        <>
          {handoff.commands.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)] flex items-center gap-1">
                  <TerminalSquare className="w-3 h-3" /> Commands, in order ({handoff.commands.length}) · copy only, nothing runs from here
                </p>
                {handoff.commands.length > 1 && <CopyButton text={allCommands} label="Copy all" />}
              </div>
              <div className="mt-1.5 space-y-2">
                {handoff.commands.map((c, i) => (
                  <div key={i} className="rounded-[8px] border border-[var(--line)] bg-black/30">
                    <div className="flex items-center justify-between px-2.5 py-1 border-b border-[var(--line)]">
                      <span className="num text-[10.5px] text-[var(--text-3)]">
                        {handoff.commands.length > 1 ? `Block ${i + 1}` : "Command"}{c.lang ? ` · ${c.lang}` : ""}
                        {handoff.sources[c.sourceIndex] ? ` · from ${handoff.sources[c.sourceIndex].label.toLowerCase()}` : ""}
                      </span>
                      <CopyButton text={c.code} />
                    </div>
                    <pre className="px-3 py-2 text-[12px] leading-relaxed text-[var(--text)] overflow-x-auto whitespace-pre">
                      <code>{c.code}</code>
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
          {handoff.steps.length > 0 && (
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)]">Steps, in order</p>
              <ol className="mt-1 list-decimal pl-5 text-[12.5px] text-[var(--text-2)] leading-snug space-y-0.5">
                {handoff.steps.map((s, i) => <li key={i} className="whitespace-pre-wrap break-words">{s}</li>)}
              </ol>
            </div>
          )}
        </>
      )}

      <div className="grid gap-2.5 sm:grid-cols-3">
        <Field label="Where to run it" value={handoff.where} absent="Not stated by the worker." />
        <Field label="Expected result" value={handoff.expected} absent="Not stated by the worker." />
        <Field label="Afterwards" value={handoff.after} absent="Not stated by the worker." />
      </div>
      <p className="text-[11.5px] text-[var(--text-3)] leading-snug">
        <span className="font-semibold text-[var(--text-2)]">In HQ: </span>{handoff.hqNext}
      </p>

      {handoff.sources.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            className="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-3)] hover:text-[var(--text)]"
            aria-expanded={showSources}
          >
            {showSources ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Full worker text ({handoff.sources.length} source{handoff.sources.length === 1 ? "" : "s"})
          </button>
          {showSources && (
            <div className="mt-1.5 space-y-2">
              {handoff.sources.map((s, i) => (
                <div key={i} className="rounded-[8px] border border-[var(--line)] px-2.5 py-2">
                  <p className="text-[10.5px] text-[var(--text-3)]">
                    {s.label}{s.at ? ` · ${new Date(s.at * 1000).toLocaleString()}` : ""}
                  </p>
                  <pre className="mt-1 text-[12px] text-[var(--text-2)] leading-relaxed whitespace-pre-wrap break-words font-sans">{s.text}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Fetches and renders the handoff for one task. `lazy` (compact surfaces)
 * shows a disclosure and only fetches when opened.
 */
export function TaskHandoffPanel({ taskId, lazy = false, refreshKey }: { taskId: string; lazy?: boolean; refreshKey?: string | number }) {
  const [open, setOpen] = useState(!lazy);
  const [data, setData] = useState<HandoffResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/hermes/tasks/${encodeURIComponent(taskId)}/handoff`, { cache: "no-store" });
      const body = (await r.json().catch(() => null)) as HandoffResponse | null;
      setData(body ?? { available: false, error: `HQ handoff API returned ${r.status}` });
    } catch (e) {
      setData({ available: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [open, load, refreshKey]);

  return (
    <div
      className="mt-3 rounded-[10px] px-3 py-2.5"
      style={{ border: "1px solid var(--line)", background: "color-mix(in srgb, var(--surface-1, #000) 60%, transparent)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-2)]">What you need to do</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-3)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-3)]" />}
      </button>
      {open && (
        <div className="mt-2.5">
          {!data && loading && <p className="text-[12px] text-[var(--text-3)]">Loading full task detail…</p>}
          {data && !data.available && (
            <div className="text-[12px] leading-snug" style={{ color: "var(--down)" }} role="alert">
              <p className="font-semibold">Full handoff unavailable</p>
              <p className="mt-0.5 text-[var(--text-2)]">
                HQ could not read this task&apos;s full detail{data.error ? ` (${data.error})` : ""}. The steps are unknown here — not absent.
                Open the task on the Hermes kanban board to read its comments.
              </p>
              <button type="button" onClick={load} className="btn-ghost mt-1.5 px-2 py-0.5 text-[11px]">Retry</button>
            </div>
          )}
          {data?.available && data.handoff && <HandoffBody handoff={data.handoff} taskId={taskId} />}
        </div>
      )}
    </div>
  );
}
