"use client";

import { useEffect, useState, useCallback } from "react";
import { Coins, RefreshCw, Cpu, Zap } from "lucide-react";
import { Panel, Skeleton, EmptyState, rise } from "@/components/ui/kit";

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
  const diff = Date.now() / 1000 - unixSeconds;
  const days = Math.floor(diff / 86400);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-codex": "OpenAI (Codex)",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  nous: "Nous",
  google: "Google",
};

function ModelCard({ m }: { m: ModelUsage }) {
  const totalTokens = (m.input_tokens || 0) + (m.output_tokens || 0);
  const providerLabel = PROVIDER_LABEL[m.provider] || m.provider || "Unknown provider";
  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text)] leading-snug">{m.model}</h3>
          <p className="text-[11.5px] text-[var(--text-3)] mt-0.5">
            {providerLabel}
            {m.aux_task && <span className="text-[var(--text-4)]"> · {m.aux_task} (auxiliary)</span>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="num text-[16px] font-semibold text-[var(--text)]">{fmtCost(m.estimated_cost)}</p>
          <p className="text-[10.5px] text-[var(--text-4)]">est. cost</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="num text-[13px] text-[var(--text)] font-medium">{fmtTokens(totalTokens)}</p>
          <p className="text-[10.5px] text-[var(--text-4)]">total tokens</p>
        </div>
        <div>
          <p className="num text-[13px] text-[var(--text)] font-medium">{m.sessions}</p>
          <p className="text-[10.5px] text-[var(--text-4)]">sessions</p>
        </div>
        <div>
          <p className="num text-[13px] text-[var(--text)] font-medium">{m.api_calls}</p>
          <p className="text-[10.5px] text-[var(--text-4)]">API calls</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] border-t border-[var(--line)] pt-3">
        <div className="flex justify-between">
          <span className="text-[var(--text-3)]">Input</span>
          <span className="num text-[var(--text-2)]">{fmtTokens(m.input_tokens)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--text-3)]">Output</span>
          <span className="num text-[var(--text-2)]">{fmtTokens(m.output_tokens)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--text-3)]">Cache read</span>
          <span className="num text-[var(--text-2)]">{fmtTokens(m.cache_read_tokens)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--text-3)]">Reasoning</span>
          <span className="num text-[var(--text-2)]">{fmtTokens(m.reasoning_tokens)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--line)] text-[11px] text-[var(--text-4)]">
        <span>Avg {fmtTokens(m.avg_tokens_per_session)}/session</span>
        <span>Last used {fmtRelative(m.last_used_at)}</span>
      </div>
    </Panel>
  );
}

export default function UsagePage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);

  const load = useCallback(async (d: number) => {
    try {
      const res = await fetch(`/api/hermes/analytics?days=${d}`, { cache: "no-store" });
      const json = (await res.json()) as AnalyticsResponse;
      setData(json);
    } catch {
      setData({ models: [], totals: null, period_days: d, error: "Failed to load" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [load, days]);

  const manualRefresh = async () => {
    setRefreshing(true);
    await load(days);
    setRefreshing(false);
  };

  const totals = data?.totals;
  const models = data?.models ?? [];

  if (loading) {
    return (
      <div className="w-full mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-48" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="panel p-5 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-10 w-full" />
            </div>
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
            Usage
          </div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            Token &amp; Cost Dashboard
          </h1>
          <p className="num text-[var(--text-4)] text-[12px] mt-3">
            {models.length} model{models.length === 1 ? "" : "s"} · last {days} days
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
        <div className="hq-rise grid grid-cols-2 md:grid-cols-4 gap-3 mb-8" style={rise(1)}>
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
            <p className="num text-[20px] font-semibold text-[var(--text)]">{totals.total_sessions}</p>
          </Panel>
          <Panel className="p-4">
            <div className="flex items-center gap-1.5 text-[var(--text-4)] mb-1.5">
              <span className="text-[10.5px] uppercase tracking-wide">Models used</span>
            </div>
            <p className="num text-[20px] font-semibold text-[var(--text)]">{totals.distinct_models}</p>
          </Panel>
        </div>
      )}

      {/* Per-model cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {models.map((m, i) => (
          <ModelCard key={`${m.model}-${m.provider}-${i}`} m={m} />
        ))}
      </div>

      {models.length === 0 && !data?.error && (
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
