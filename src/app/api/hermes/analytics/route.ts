import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ────────────────────────────────────────────────────────────────
   Proxies the real Hermes dashboard's per-model token/cost analytics
   (/api/analytics/models) so the /usage page can show real usage
   without exposing dashboard session cookies to the browser.
   Same login pattern as kanban-dashboard-client.ts.
   ──────────────────────────────────────────────────────────────── */

const DASHBOARD_URL = (process.env.HERMES_DASHBOARD_URL || "").replace(/\/+$/, "");
const USERNAME = process.env.HERMES_DASHBOARD_USERNAME || "";
const PASSWORD = process.env.HERMES_DASHBOARD_PASSWORD || "";

let cookieHeader: string | null = null;

function extractCookieHeader(res: Response): string | null {
  const raw =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  const pairs = raw.map((line) => line.split(";", 1)[0]).filter(Boolean);
  return pairs.length ? pairs.join("; ") : null;
}

async function login(): Promise<string> {
  if (!DASHBOARD_URL || !USERNAME || !PASSWORD) {
    throw new Error("Dashboard bridging not configured");
  }
  const res = await fetch(`${DASHBOARD_URL}/auth/password-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "basic", username: USERNAME, password: PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Dashboard login failed (${res.status})`);
  const cookies = extractCookieHeader(res);
  if (!cookies) throw new Error("Dashboard login returned no session cookies");
  cookieHeader = cookies;
  return cookieHeader;
}

async function dashboardGet(path: string) {
  if (!cookieHeader) await login();
  const doFetch = () =>
    fetch(`${DASHBOARD_URL}${path}`, {
      headers: { Cookie: cookieHeader! },
      signal: AbortSignal.timeout(20000),
    });
  let res = await doFetch();
  if (res.status === 401) {
    await login();
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`Dashboard API ${path} → ${res.status}`);
  return res.json();
}

// GET /api/hermes/analytics?days=30 — per-model token/cost breakdown
//
// The upstream endpoint returns one row per (model, provider, aux-task) —
// e.g. a vision-analysis call and a context-compression call both using
// "gpt-5.6-terra" show up as separate near-zero rows alongside the real
// agent-usage row for the same model. That reads as duplicate/confusing
// entries on the dashboard, so we roll every row sharing a model name
// (case-insensitive) into a single aggregate before returning it.
interface RawModelRow {
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

const SUM_KEYS = [
  "input_tokens", "output_tokens", "cache_read_tokens", "reasoning_tokens",
  "estimated_cost", "actual_cost", "sessions", "api_calls", "tool_calls",
] as const;

function mergeModelRows(rows: RawModelRow[]): RawModelRow[] {
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
    // Prefer the row with the most sessions as the "primary" for display
    // name/provider/capabilities; sum everything else across all rows.
    const primary = [...list].sort((a, b) => (b.sessions || 0) - (a.sessions || 0))[0];
    const out: RawModelRow = { ...primary };
    for (const key of SUM_KEYS) {
      out[key] = list.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
    }
    out.last_used_at = list.reduce(
      (max, r) => Math.max(max, r.last_used_at || 0),
      0
    ) || null;
    const totalTokens = (out.input_tokens || 0) + (out.output_tokens || 0);
    out.avg_tokens_per_session = out.sessions ? totalTokens / (out.sessions as number) : 0;
    // Keep richest capabilities object among the merged rows.
    out.capabilities = list.find((r) => r.capabilities && Object.keys(r.capabilities).length)?.capabilities || primary.capabilities;
    merged.push(out);
  }
  return merged;
}

export async function GET(req: Request) {
  const days = new URL(req.url).searchParams.get("days") || "30";
  try {
    const data = await dashboardGet(`/api/analytics/models?days=${encodeURIComponent(days)}`);
    if (data && Array.isArray(data.models)) {
      data.models = mergeModelRows(data.models);
      data.models.sort((a: RawModelRow, b: RawModelRow) => (b.estimated_cost || 0) - (a.estimated_cost || 0));
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), models: [], totals: null, period_days: Number(days) },
      { status: 500 }
    );
  }
}
