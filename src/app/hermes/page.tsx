"use client";

/* Dispatch: the single conversation surface. Composer (with "Dispatch to"
   profile selector) → Approval inbox (shared component, same as Home) →
   In flight → conversation threads (filter / search / paginated). Recurring
   jobs moved to /schedules; Hermes activity events moved to Tasks → History. */

import { Suspense, useEffect, useRef, useState } from "react";
import { Send, RefreshCw, Check } from "lucide-react";
import { Panel, Button, Eyebrow } from "@/components/ui/kit";
import { HermesConversations } from "@/components/hermes-conversations";
import { ApprovalInbox } from "@/components/approval-inbox";
import { navLabel } from "@/components/nav-config";
import { DEFAULT_DISPATCH_PROFILE, DISPATCH_TARGETS } from "@/lib/dispatch-targets";

// ── Dispatch bar ──────────────────────────────────────────
function DispatchBar({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [side, setSide] = useState(false);
  const [profile, setProfile] = useState(DEFAULT_DISPATCH_PROFILE);
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
        body: JSON.stringify({ kind: "oneshot", title, sideEffecting: side, assignee: profile }),
      });
      if (r.ok) {
        setText("");
        flash(
          side
            ? "Sent to approval inbox — awaiting your go-ahead."
            : profile === DEFAULT_DISPATCH_PROFILE
              ? "Queued for Hermes."
              : `Queued for the ${profile} profile.`
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
          placeholder={profile === DEFAULT_DISPATCH_PROFILE ? "Ask or tell Hermes to do something…" : `Ask the ${profile} profile to do something…`}
          className="flex-1 min-w-0 bg-transparent text-[14px] text-[var(--text)] placeholder:text-[var(--text-3)] px-3.5 py-2.5 rounded-[10px] border border-[var(--line)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] outline-none transition-colors"
        />
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-2)]">
            <span className="whitespace-nowrap">Dispatch to</span>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              aria-label="Dispatch to Hermes profile"
              className="bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)] px-2.5 py-1.5 rounded-[8px] text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
            >
              {DISPATCH_TARGETS.map((t) => (
                <option key={t.profile} value={t.profile}>{t.label}</option>
              ))}
            </select>
          </label>
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

// ── Main ──────────────────────────────────────────────────
export default function HermesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const bump = () => setRefreshKey((k) => k + 1);

  const manualRefresh = () => {
    setRefreshing(true);
    bump();
    window.setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      {/* Header */}
      <div className="hq-rise pt-4 pb-8 flex items-end justify-between gap-4">
        <div>
          <Eyebrow>Hermes · conversations</Eyebrow>
          <h1 className="mt-2.5 text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            {navLabel("/hermes")}
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
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

      {/* Composer */}
      <div className="hq-rise">
        <DispatchBar onDone={bump} />
      </div>

      {/* Approval inbox — the same shared component as Home (approvals,
          blocked-on-you tasks, and follow-ups), so the two can't disagree. */}
      <section className="mt-12" id="approval-inbox">
        <ApprovalInbox />
      </section>

      {/* In flight + conversation threads (one requests poll) */}
      <section className="mt-12">
        <Suspense fallback={null}>
          <HermesConversations refreshKey={refreshKey} />
        </Suspense>
      </section>
    </div>
  );
}
