// Thin client for the Hermes dashboard's authenticated REST API
// (username/password provider — see plugins/dashboard_auth/basic on the
// Hermes side). This is the ONLY write path into kanban.db: the OpenAI-
// compatible API server (port 8642, used elsewhere in this bridge) has no
// kanban endpoints, and the raw kanban.db bind-mount is read-only by design.
//
// Login → cookie-signed session (access + refresh tokens, ~12h TTL by
// default) → every subsequent call replays those cookies. On a 401 (expired
// or first-ever call) we transparently re-login once and retry.
//
// Requires env: HERMES_DASHBOARD_URL, HERMES_DASHBOARD_USERNAME,
//               HERMES_DASHBOARD_PASSWORD.

const DASHBOARD_URL = (process.env.HERMES_DASHBOARD_URL || "").replace(/\/+$/, "");
const USERNAME = process.env.HERMES_DASHBOARD_USERNAME || "";
const PASSWORD = process.env.HERMES_DASHBOARD_PASSWORD || "";

let cookieHeader = null; // cached "name=value; name2=value2" string

function configured() {
  return Boolean(DASHBOARD_URL && USERNAME && PASSWORD);
}

// Parses one or more Set-Cookie response headers into a single Cookie header value.
function extractCookieHeader(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.raw?.()["set-cookie"] || [];
  const pairs = raw.map((line) => line.split(";", 1)[0]).filter(Boolean);
  return pairs.length ? pairs.join("; ") : null;
}

async function login() {
  if (!configured()) {
    throw new Error(
      "Dashboard bridging not configured: set HERMES_DASHBOARD_URL, " +
        "HERMES_DASHBOARD_USERNAME, HERMES_DASHBOARD_PASSWORD"
    );
  }
  const res = await fetch(`${DASHBOARD_URL}/auth/password-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "basic", username: USERNAME, password: PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Dashboard login failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const cookies = extractCookieHeader(res);
  if (!cookies) throw new Error("Dashboard login succeeded but returned no session cookies");
  cookieHeader = cookies;
  return cookieHeader;
}

// Authenticated fetch against the dashboard's REST API (kanban plugin routes
// live under /api/plugins/kanban/*). Retries once after a fresh login on 401.
async function dashboardFetch(path, { method = "GET", body } = {}) {
  if (!cookieHeader) await login();
  const doFetch = () =>
    fetch(`${DASHBOARD_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });

  let res = await doFetch();
  if (res.status === 401) {
    await login();
    res = await doFetch();
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(`Dashboard API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Creates a real kanban task, assigned to the default worker by default so
// it dispatches immediately — same fast path as a Telegram/CLI-originated
// ask (bypasses the triage hop unless the caller explicitly opts in).
export async function kanbanCreateTask({ title, body, assignee = "default", triage = false }) {
  const data = await dashboardFetch("/api/plugins/kanban/tasks", {
    method: "POST",
    body: { title: title.slice(0, 200), body: body || null, assignee, triage },
  });
  return data?.task;
}

export async function kanbanGetTask(id) {
  return dashboardFetch(`/api/plugins/kanban/tasks/${id}`);
}

// Returns the dashboard's canonical board projection. Archived cards are not
// included unless callers explicitly request them, so downstream mirrors cannot
// mislabel archived work as active lifecycle cards.
export async function kanbanGetBoard(board = "default") {
  const params = new URLSearchParams({ board, _: String(Date.now()) });
  return dashboardFetch(`/api/plugins/kanban/board?${params}`);
}

export { configured as dashboardConfigured };
