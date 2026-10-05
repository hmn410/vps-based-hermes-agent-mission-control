import { NextResponse } from "next/server";
import { shapeAnalytics } from "@/lib/usage-analytics";

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

// GET /api/hermes/analytics?days=30 — per-model token/cost breakdown.
//
// Rows sharing a model name are merged, and the totals tiles are derived from
// those same rows (see src/lib/usage-analytics.ts for why the upstream
// `totals` cannot be used: they omit auxiliary-usage rows that models[] has).
export async function GET(req: Request) {
  const days = new URL(req.url).searchParams.get("days") || "30";
  try {
    const data = await dashboardGet(`/api/analytics/models?days=${encodeURIComponent(days)}`);
    return NextResponse.json(shapeAnalytics(data ?? {}));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), models: [], totals: null, period_days: Number(days) },
      { status: 500 }
    );
  }
}
