/* Usage analytics shaping for /usage.

   Root cause of "total cost lower than one model row": the upstream Hermes
   dashboard (/api/analytics/models) computes `totals` with a sessions-table
   SQL query, but its `models[]` list ALSO appends auxiliary-usage rows
   (vision / context-compression calls recorded outside the sessions table).
   Those aux rows carry real cost and tokens that the upstream totals never
   include, and we then merge rows by model name — so one merged model row
   could exceed the "total". Tiles and rows must share one source: we derive
   the cost / token / API-call totals from the exact rows the page renders.

   Upstream aux usage is recorded only in session_model_usage and never in the
   sessions counters, so cost, tokens and API calls are additive across rows.
   Session counts are NOT: an aux row counts sessions that the main row
   already counted. The Sessions tile therefore keeps the upstream distinct
   session count when available. */

export interface RawModelRow {
  model: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  reasoning_tokens?: number;
  estimated_cost?: number;
  actual_cost?: number;
  sessions?: number;
  api_calls?: number;
  tool_calls?: number;
  last_used_at?: number | null;
  avg_tokens_per_session?: number;
  capabilities?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageTotals {
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

const SUM_KEYS = [
  "input_tokens", "output_tokens", "cache_read_tokens", "reasoning_tokens",
  "estimated_cost", "actual_cost", "sessions", "api_calls", "tool_calls",
] as const;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Roll every upstream row sharing a model name (case-insensitive) into one. */
export function mergeModelRows(rows: RawModelRow[]): RawModelRow[] {
  const groups = new Map<string, RawModelRow[]>();
  for (const row of rows) {
    const key = (row.model || "unknown").trim().toLowerCase();
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const merged: RawModelRow[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      merged.push(list[0]);
      continue;
    }
    // The row with the most sessions supplies display name/provider/capabilities.
    const primary = [...list].sort((a, b) => n(b.sessions) - n(a.sessions))[0];
    const out: RawModelRow = { ...primary };
    for (const key of SUM_KEYS) out[key] = list.reduce((sum, r) => sum + n(r[key]), 0);
    out.last_used_at = list.reduce((max, r) => Math.max(max, n(r.last_used_at)), 0) || null;
    const totalTokens = n(out.input_tokens) + n(out.output_tokens);
    out.avg_tokens_per_session = out.sessions ? totalTokens / n(out.sessions) : 0;
    out.capabilities =
      list.find((r) => r.capabilities && Object.keys(r.capabilities).length)?.capabilities || primary.capabilities;
    merged.push(out);
  }
  merged.sort((a, b) => n(b.estimated_cost) - n(a.estimated_cost));
  return merged;
}

/** Totals computed from the same rows the page lists, so a tile can never be
 *  smaller than any single row. */
export function totalsFromRows(rows: RawModelRow[]): UsageTotals {
  const sum = (key: keyof RawModelRow) => rows.reduce((acc, r) => acc + n(r[key]), 0);
  return {
    distinct_models: new Set(rows.map((r) => (r.model || "unknown").trim().toLowerCase())).size,
    total_input: sum("input_tokens"),
    total_output: sum("output_tokens"),
    total_cache_read: sum("cache_read_tokens"),
    total_reasoning: sum("reasoning_tokens"),
    total_estimated_cost: sum("estimated_cost"),
    total_actual_cost: sum("actual_cost"),
    total_sessions: sum("sessions"),
    total_api_calls: sum("api_calls"),
  };
}

/** Shape the upstream payload: merged rows + row-derived totals. The upstream
 *  sessions-only totals are kept as `session_totals` for reference. */
export function shapeAnalytics<T extends { models?: unknown; totals?: unknown }>(data: T) {
  const rows = Array.isArray(data.models) ? mergeModelRows(data.models as RawModelRow[]) : [];
  const totals = totalsFromRows(rows);
  const upstreamSessions = (data.totals as { total_sessions?: unknown } | null | undefined)?.total_sessions;
  if (rows.length && typeof upstreamSessions === "number" && Number.isFinite(upstreamSessions)) {
    totals.total_sessions = upstreamSessions; // distinct sessions; row sums double-count aux rows
  }
  return {
    ...data,
    models: rows,
    totals,
    session_totals: data.totals ?? null,
    totals_source: "rows" as const,
  };
}
