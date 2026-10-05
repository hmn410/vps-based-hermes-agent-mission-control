"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Coins, RefreshCw, Cpu, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { Panel, Pill, Skeleton, EmptyState, rise } from "@/components/ui/kit";

interface ModelUsage {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
  tool_calls: number;
  last_used_at: number | null;
  avg_tokens_per_session: number;
  aux_task?: string;
  capabilities?: {
    supports_tools?: boolean;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    model_family?: string;
  };
}

interface Totals {
  distinct_models: number;
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_reasoning: number;
  total_estimated_cost: number;
  total_actual_cost: number;
  total_sessions: number;
  total_api_calls: number;
}

interface AnalyticsResponse {
  models: ModelUsage[];
  totals: Totals | null;
  period_days: number;
  error?: string;
}

function fmtTokens(n: number | null | undefined) {
  const v = n || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtCost(n: number | null | undefined) {
  const v = n || 0;
  return v === 0 ? "$0.00" : `$${v.toFixed(2)}`;
}

function fmtRelative(unixSeconds: number | null | undefined) {
  if (!unixSeconds) return "—";
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days === 0) return "Today";
  if (days === 1 && hours === 0) return "Yesterday";
  // Analytics windows are rolling 24-hour periods. Include hours once a
  // session is older than a day so "7d ago" cannot imply it is in the 7d view.
  return hours > 0 ? `${days}d ${hours}h ago` : `${days}d ago`;
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-codex": "OpenAI (Codex)",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  nous: "Nous",
  google: "Google",
};

// A card only earns a spot in the main list once it costs something or has
// meaningful token volume — tiny/near-zero auxiliary rows (vision probes,
// compression calls, stray session-only rows) get folded into a collapsed
// "Minor / auxiliary" section instead of cluttering the primary view.
const MINOR_TOKEN_THRESHOLD = 5000;
const USAGE_POLL_MS = 60_000;
function isMinor(m: ModelUsage) {
  const tokens = (m.input_tokens || 0) + (m.output_tokens || 0);
  return (m.estimated_cost || 0) === 0 && tokens < MINOR_TOKEN_THRESHOLD;
}

function ModelRow({ m, maxCost }: { m: ModelUsage; maxCost: number }) {
  const totalTokens = (m.input_tokens || 0) + (m.output_tokens || 0);
  const providerLabel = PROVIDER_LABEL[m.provider] || m.provider || "Unknown";
  const barPct = maxCost > 0 ? Math.max(4, ((m.estimated_cost || 0) / maxCost) * 100) : 0;

  return (
    <div className="grid grid-cols-[1.6fr_0.9fr_0.9fr_0.7fr_0.9fr] items-center gap-3 px-4 py-3 border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--surface-1)] transition-colors">
      {/* Model + provider */}
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-[var(--text)] truncate">{m.model}</p>
        <p className="text-[11px] text-[var(--text-4)] mt-0.5">
          {providerLabel}
          {m.aux_task && <span> · {m.aux_task}</span>}
        </p>
      </div>

      {/* Cost, with a relative bar so the eye lands on the expensive ones */}
      <div>
        <p className="num text-[13px] font-semibold text-[var(--text)]">{fmtCost(m.estimated_cost)}</p>
        <div className="h-1 rounded-full bg-[var(--surface-2)] mt-1 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${barPct}%`, background: "var(--accent)" }}
          />
        </div>
      </div>

      {/* Tokens */}
      <div>
        <p className="num text-[13px] text-[var(--text-2)]">{fmtTokens(totalTokens)}</p>
        <p className="text-[10.5px] text-[var(--text-4)] mt-0.5">
          {fmtTokens(m.input_tokens)} in · {fmtTokens(m.output_tokens)} out
        </p>
      </div>

      {/* Sessions / calls */}
      <div>
        <p className="num text-[13px] text-[var(--text-2)]">{m.sessions}</p>
        <p className="text-[10.5px] text-[var(--text-4)] mt-0.5">{(m.api_calls || 0).toLocaleString()} API calls</p>
      </div>

      {/* Last used */}
      <div className="text-right">
        <p className="text-[11.5px] text-[var(--text-3)]">{fmtRelative(m.last_used_at)}</p>
      </div>
    </div>
  );
}

function MinorRow({ m }: { m: ModelUsage }) {
  const totalTokens = (m.input_tokens || 0) + (m.output_tokens || 0);
  const providerLabel = PROVIDER_LABEL[m.provider] || m.provider || "Unknown";
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--line)] last:border-b-0 text-[12px]">
      <span className="text-[var(--text-2)] truncate">
        {m.model} <span className="text-[var(--text-4)]">· {providerLabel}</span>
        {m.aux_task && <span className="text-[var(--text-4)]"> · {m.aux_task}</span>}
      </span>
      <span className="num text-[var(--text-4)] shrink-0">{fmtTokens(totalTokens)} tok</span>
    </div>
  );
}

export default function UsagePage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);
  const [showMinor, setShowMinor] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async (d: number) => {
    try {
      const res = await fetch(`/api/hermes/analytics?days=${d}`, { cache: "no-store" });
      const json = (await res.json()) as AnalyticsResponse;
      setData(json);
      setUpdatedAt(Date.now());
    } catch {
      setData({ models: [], totals: null, period_days: d, error: "Failed to load" });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount / window change, then keep the view live: poll while the
  // tab is visible and refetch when it regains focus. Previously the page only
  // loaded once, so a tab left open overnight kept showing stale numbers.
  useEffect(() => {
    void load(days);
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(days);
    }, USAGE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(days);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load, days]);

  const manualRefresh = async () => {
    setRefreshing(true);
    await load(days);
    setRefreshing(false);
  };

  const totals = data?.totals;
  const allModels = useMemo(() => (data?.totals ? data.models : []), [data]);

  const { active, minor, maxCost } = useMemo(() => {
    const active: ModelUsage[] = [];
    const minor: ModelUsage[] = [];
    for (const m of allModels) (isMinor(m) ? minor : active).push(m);
    active.sort((a, b) => (b.estimated_cost || 0) - (a.estimated_cost || 0));
    minor.sort((a, b) => ((b.input_tokens || 0) + (b.output_tokens || 0)) - ((a.input_tokens || 0) + (a.output_tokens || 0)));
    const maxCost = active.reduce((m, r) => Math.max(m, r.estimated_cost || 0), 0);
    return { active, minor, maxCost };
  }, [allModels]);

  if (loading) {
    return (
      <div className="w-full mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-48" />
          </div>
        </div>
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto p-6 pb-16">
      {/* Header */}
      <div className="hq-rise flex items-end justify-between gap-4 pt-2 pb-8 flex-wrap" style={rise(0)}>
        <div>
          <div className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5" />
            Tokens &amp; cost
          </div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            Usage
          </h1>
          <p className="num text-[var(--text-4)] text-[12px] mt-3">
            {active.length} active model{active.length === 1 ? "" : "s"}
            {minor.length > 0 && ` · ${minor.length} minor`} · last {days} days
            {updatedAt && ` · updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </p>
          <p className="text-[var(--text-4)] text-[11px] mt-1">
            Hermes-recorded sessions only. Direct Claude Code CLI runs outside Hermes are not counted.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors border ${
                days === d
                  ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--line-strong)]"
                  : "text-[var(--text-3)] hover:text-[var(--text)] border-[var(--line)] hover:border-[var(--line-strong)]"
              }`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={manualRefresh}
            disabled={refreshing}
            className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {data?.error && (
        <div className="panel p-4 mb-6" style={{ borderColor: "color-mix(in srgb, var(--down) 30%, transparent)" }}>
          <p className="text-[13px]" style={{ color: "var(--down)" }}>Couldn&apos;t load usage data: {data.error}</p>
        </div>
      )}

      {/* Totals strip */}
      {totals && (
        <div className="hq-rise grid grid-cols-2 md:grid-cols-5 gap-3 mb-8" style={rise(1)}>
          <Panel className="p-4">
            <div className="flex items-center gap-1.5 text-[var(--text-4)] mb-1.5">
              <Coins className="w-3.5 h-3.5" />
              <span className="text-[10.5px] uppercase tracking-wide">Est. cost</span>
            </div>
            <p className="num text-[20px] font-semibold text-[var(--text)]">{fmtCost(totals.total_estimated_cost)}</p>
          </Panel>
          <Panel className="p-4">
            <div className="flex items-center gap-1.5 text-[var(--text-4)] mb-1.5">
              <Zap className="w-3.5 h-3.5" />
              <span className="text-[10.5px] uppercase tracking-wide">Total tokens</span>
            </div>
            <p className="num text-[20px] font-semibold text-[var(--text)]">
              {fmtTokens((totals.total_input || 0) + (totals.total_output || 0))}
            </p>
          </Panel>
          <Panel className="p-4">
            <div className="flex items-center gap-1.5 text-[var(--text-4)] mb-1.5">
              <Cpu className="w-3.5 h-3.5" />
              <span className="text-[10.5px] uppercase tracking-wide">Sessions</span>
            </div>
            <p className="num text-[20px] font-semibold text-[var(--text)]">{(totals.total_sessions || 0).toLocaleString()}</p>
          </Panel>
          <Panel className="p-4">
            <div className="flex items-center gap-1.5 text-[var(--text-4)] mb-1.5">
              <span className="text-[10.5px] uppercase tracking-wide">API calls</span>
            </div>
            <p className="num text-[20px] font-semibold text-[var(--text)]">{(totals.total_api_calls || 0).toLocaleString()}</p>
          </Panel>
          <Panel className="p-4">
            <div className="flex items-center gap-1.5 text-[var(--text-4)] mb-1.5">
              <span className="text-[10.5px] uppercase tracking-wide">Models used</span>
            </div>
            <p className="num text-[20px] font-semibold text-[var(--text)]">{totals.distinct_models}</p>
          </Panel>
        </div>
      )}

      {/* Active models — table, sorted by cost desc, most-used stands out via bar */}
      {active.length > 0 && (
        <Panel className="p-0 overflow-hidden mb-6">
          <div className="grid grid-cols-[1.6fr_0.9fr_0.9fr_0.7fr_0.9fr] gap-3 px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface-1)]">
            <span className="text-[10.5px] uppercase tracking-wide text-[var(--text-4)]">Model</span>
            <span className="text-[10.5px] uppercase tracking-wide text-[var(--text-4)]">Est. cost</span>
            <span className="text-[10.5px] uppercase tracking-wide text-[var(--text-4)]">Tokens</span>
            <span className="text-[10.5px] uppercase tracking-wide text-[var(--text-4)]">Sessions</span>
            <span className="text-[10.5px] uppercase tracking-wide text-[var(--text-4)] text-right">Last used</span>
          </div>
          {active.map((m, i) => (
            <ModelRow key={`${m.model}-${m.provider}-${i}`} m={m} maxCost={maxCost} />
          ))}
        </Panel>
      )}

      {/* Minor / auxiliary — collapsed by default so it doesn't compete for attention */}
      {minor.length > 0 && (
        <Panel className="p-0 overflow-hidden">
          <button
            onClick={() => setShowMinor((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--surface-1)] transition-colors"
          >
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-2)]">
              {showMinor ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Minor &amp; auxiliary usage
              <Pill tone="neutral">{minor.length}</Pill>
            </span>
            <span className="text-[11px] text-[var(--text-4)]">No meaningful cost or token volume</span>
          </button>
          {showMinor && (
            <div className="border-t border-[var(--line)]">
              {minor.map((m, i) => (
                <MinorRow key={`${m.model}-${m.provider}-minor-${i}`} m={m} />
              ))}
            </div>
          )}
        </Panel>
      )}

      {active.length === 0 && minor.length === 0 && !data?.error && (
        <div className="panel">
          <EmptyState
            icon={<Coins className="w-8 h-8" />}
            title="No usage in this window"
            hint="Try a longer time range"
          />
        </div>
      )}
    </div>
  );
}
