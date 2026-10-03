/* ────────────────────────────────────────────────────────────────
   Server-only client for the Hermes dashboard's kanban REST API.
   Lets the website itself issue task actions (unblock, mark done,
   archive) without a round trip through hermes-bridge — same
   credentials (HERMES_DASHBOARD_URL/USERNAME/PASSWORD) already used
   by the bridge, read directly from this app's own .env.
   ──────────────────────────────────────────────────────────────── */

const DASHBOARD_URL = (process.env.HERMES_DASHBOARD_URL || "").replace(/\/+$/, "");
const USERNAME = process.env.HERMES_DASHBOARD_USERNAME || "";
const PASSWORD = process.env.HERMES_DASHBOARD_PASSWORD || "";

let cookieHeader: string | null = null;

function configured() {
  return Boolean(DASHBOARD_URL && USERNAME && PASSWORD);
}

function extractCookieHeader(res: Response): string | null {
  const raw =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  const pairs = raw.map((line) => line.split(";", 1)[0]).filter(Boolean);
  return pairs.length ? pairs.join("; ") : null;
}

async function login(): Promise<string> {
  if (!configured()) {
    throw new Error(
      "Dashboard bridging not configured: set HERMES_DASHBOARD_URL, HERMES_DASHBOARD_USERNAME, HERMES_DASHBOARD_PASSWORD"
    );
  }
  const res = await fetch(`${DASHBOARD_URL}/auth/password-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "basic", username: USERNAME, password: PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Dashboard login failed (${res.status}): ${text.slice(0, 300)}`);
  const cookies = extractCookieHeader(res);
  if (!cookies) throw new Error("Dashboard login succeeded but returned no session cookies");
  cookieHeader = cookies;
  return cookieHeader;
}

async function dashboardFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!cookieHeader) await login();
  const doFetch = () =>
    fetch(`${DASHBOARD_URL}${path}`, {
      method: init.method || "GET",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader! },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  let res = await doFetch();
  if (res.status === 401) {
    await login();
    res = await doFetch();
  }
  const text = await res.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(`Dashboard API ${init.method || "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    throw err;
  }
  return data as T;
}

export const kanbanDashboardConfigured = configured;

// Creates a real kanban task from the website (ideas board etc.), landing in
// triage by default so a routing profile can flesh it out before any worker
// picks it up — approving an idea should make it visible on the board, not
// silently kick off unattended agent work.
export async function kanbanCreateTask({
  title,
  body,
  assignee = "default",
  triage = true,
}: {
  title: string;
  body?: string | null;
  assignee?: string;
  triage?: boolean;
}): Promise<{ task?: { id: string } }> {
  return dashboardFetch(`/api/plugins/kanban/tasks`, {
    method: "POST",
    body: { title: title.slice(0, 200), body: body || null, assignee, triage },
  });
}

// Task lifecycle actions surfaced as buttons on the /tasks page so the
// common "clear this up" moves don't require opening the full kanban board.
export type KanbanTaskAction = "unblock" | "archive" | "complete" | "ready";

export async function kanbanTaskAction(id: string, action: KanbanTaskAction) {
  const statusByAction: Record<KanbanTaskAction, string> = {
    unblock: "ready",
    archive: "archived",
    complete: "done",
    ready: "ready",
  };
  return dashboardFetch(`/api/plugins/kanban/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { status: statusByAction[action] },
  });
}
