"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Sparkles } from "lucide-react";
import { Panel, Eyebrow, EmptyState } from "@/components/ui/kit";

interface Overview {
  total: number | null;
  summary: string | null;
  generatedAt: string | null;
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return null;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// Reads a Hermes-written inbox overview (generated via the hermes-bridge →
// Hermes's API server chat completion). GET reads the cached result only —
// no auto-refresh. The refresh button is the only thing that spends tokens.
export function GmailPanel({ className = "" }: { className?: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [connected, setConnected] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hermes/gmail-overview");
      if (r.ok) {
        const d = await r.json();
        setOverview(d);
      }
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/hermes/gmail-overview", { method: "POST" });
      if (r.status === 400) setConnected(false);
    } catch { /* ignore */ }
  }, []);

  // Load the cached overview once on mount. Do NOT auto-trigger a refresh —
  // that used to fire on every page load plus every 5 minutes, burning
  // Hermes tokens for a summary nobody was looking at. Generation now only
  // happens when the user clicks the refresh button.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (overview?.summary) setRefreshing(false);
  }, [overview?.summary, overview?.generatedAt]);

  // After clicking refresh, poll the cached result for a bit so the new
  // summary appears without a manual page reload, then stop.
  useEffect(() => {
    if (!refreshing) return;
    const poll = setInterval(load, 3000);
    const stop = setTimeout(() => clearInterval(poll), 2 * 60 * 1000);
    return () => { clearInterval(poll); clearTimeout(stop); };
  }, [refreshing, load]);

  const empty = !overview || overview.summary === null;

  return (
    <Panel className={`flex h-full flex-col p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Mail className="w-4 h-4 shrink-0 text-[var(--accent)]" />
          <Eyebrow className="truncate">Gmail · AI overview</Eyebrow>
        </div>
        <button onClick={refresh} className="btn-ghost p-1.5 rounded-full shrink-0" aria-label="Refresh" disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!connected ? (
        <EmptyState icon={<Mail className="w-5 h-5" />} title="Gmail is not connected" hint="Sign out and back in to grant Gmail access." />
      ) : empty ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[13px] text-[var(--text-3)]">{refreshing ? "Hermes is reading your inbox…" : "No overview yet — hit refresh."}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {overview.total !== null && (
            <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-[var(--line)] shrink-0">
              <span className="num text-[30px] font-semibold leading-none text-[var(--text)]">{overview.total}</span>
              <span className="text-[12px] font-medium text-[var(--text-2)]">unread in Inbox</span>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--accent)]" />
              <p className="text-[13px] leading-relaxed text-[var(--text-2)]">{overview.summary}</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[var(--text-3)] shrink-0">
            Written by Hermes {timeAgo(overview.generatedAt) ?? ""} · click refresh for a new summary
          </p>
        </div>
      )}
    </Panel>
  );
}
