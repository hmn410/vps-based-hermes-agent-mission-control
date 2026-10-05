"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Mail, RefreshCw, Sparkles } from "lucide-react";
import { Panel, Eyebrow, EmptyState } from "@/components/ui/kit";
import { hasGmailData, isSummaryStale, type GmailOverviewData } from "@/lib/gmail-overview";

type Overview = GmailOverviewData;

export type GmailConnection = "loading" | "connected" | "not_connected";

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

// The AI summary can contain sensitive personal detail, so it is collapsed by
// default (only the unread count shows) and the choice persists per browser.
const SUMMARY_PREF_KEY = "hq:gmail-summary-expanded";
const PREF_EVENT = "hq:gmail-summary-pref";

function subscribePref(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(PREF_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PREF_EVENT, cb);
  };
}
function readPref(): boolean {
  try { return window.localStorage.getItem(SUMMARY_PREF_KEY) === "1"; } catch { return false; }
}
function writePref(expanded: boolean) {
  try { window.localStorage.setItem(SUMMARY_PREF_KEY, expanded ? "1" : "0"); } catch { /* private mode */ }
  window.dispatchEvent(new Event(PREF_EVENT));
}
function useSummaryExpanded(): [boolean, (v: boolean) => void] {
  // Server render and first paint are always collapsed.
  const expanded = useSyncExternalStore(subscribePref, readPref, () => false);
  return [expanded, writePref];
}

// Reads a Hermes-written inbox overview (generated via the hermes-bridge →
// Hermes's API server chat completion). GET reads the cached result only —
// no auto-refresh. The refresh button is the only thing that spends tokens.
export function GmailPanel({
  className = "",
  onConnection,
}: {
  className?: string;
  onConnection?: (state: GmailConnection) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useSummaryExpanded();
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hermes/gmail-overview");
      if (r.ok) {
        const d = await r.json();
        setOverview(d);
      }
    } catch { /* ignore */ }
    setLoaded(true);
    setNow(Date.now());
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/hermes/gmail-overview", { method: "POST" });
      if (r.status === 400) { setConnected(false); setRefreshing(false); }
    } catch { /* ignore */ }
  }, []);

  // Load the cached overview once on mount. Do NOT auto-trigger a refresh —
  // generation only happens when the user clicks the refresh button.
  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    // Keep the staleness warning honest for a tab left open.
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(first); clearInterval(tick); };
  }, [load]);

  useEffect(() => {
    if (!overview?.summary) return;
    const t = setTimeout(() => setRefreshing(false), 0);
    return () => clearTimeout(t);
  }, [overview?.summary, overview?.generatedAt]);

  // After clicking refresh, poll the cached result for a bit so the new
  // summary appears without a manual page reload, then stop.
  useEffect(() => {
    if (!refreshing) return;
    const poll = setInterval(load, 3000);
    const stop = setTimeout(() => clearInterval(poll), 2 * 60 * 1000);
    return () => { clearInterval(poll); clearTimeout(stop); };
  }, [refreshing, load]);

  const hasData = hasGmailData(overview);
  const connection: GmailConnection = !loaded ? "loading" : connected && hasData ? "connected" : "not_connected";
  useEffect(() => { onConnection?.(connection); }, [connection, onConnection]);

  const empty = !overview || overview.summary === null;
  const stale = isSummaryStale(overview?.generatedAt, now);

  return (
    <Panel className={`flex h-full flex-col p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Mail className="w-4 h-4 shrink-0 text-[var(--accent)]" />
          <Eyebrow className="truncate">Gmail · personal</Eyebrow>
        </div>
        <button onClick={refresh} className="btn-ghost p-1.5 rounded-full shrink-0" aria-label="Refresh Gmail summary" title="Ask Hermes for a new summary" disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!connected ? (
        <EmptyState icon={<Mail className="w-5 h-5" />} title="Gmail is not connected" hint="Sign out and back in to grant Gmail access." />
      ) : !loaded ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[13px] text-[var(--text-3)]">Loading…</p>
        </div>
      ) : empty ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[13px] text-[var(--text-3)]">{refreshing ? "Hermes is reading your inbox…" : "No overview yet — hit refresh."}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-[var(--line)] shrink-0">
            {overview.total !== null && (
              <>
                <span className="num text-[30px] font-semibold leading-none text-[var(--text)]">{overview.total}</span>
                <span className="text-[12px] font-medium text-[var(--text-2)]">unread in Inbox</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls="gmail-summary"
              className="btn-ghost ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] shrink-0"
            >
              {expanded ? "Hide summary" : "Show summary"}
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
          {stale && (
            <p className="mb-3 flex items-center gap-1.5 text-[11.5px] shrink-0" style={{ color: "var(--warn)" }} role="note">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Summary was written {timeAgo(overview.generatedAt)} — counts and details may be out of date. Refresh for a current one.
            </p>
          )}
          {expanded ? (
            <div id="gmail-summary" className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--accent)]" />
                <p className="text-[13px] leading-relaxed text-[var(--text-2)]">{overview.summary}</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 text-[12px] text-[var(--text-3)]">AI summary hidden — it can include personal details.</div>
          )}
          <p className="mt-3 text-[11px] text-[var(--text-3)] shrink-0">
            Written by Hermes {timeAgo(overview.generatedAt) ?? ""} · refresh for a new summary
          </p>
        </div>
      )}
    </Panel>
  );
}
