import assert from "node:assert/strict";
import test from "node:test";

test("reads the canonical non-archived board through the dashboard API", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    url: process.env.HERMES_DASHBOARD_URL,
    username: process.env.HERMES_DASHBOARD_USERNAME,
    password: process.env.HERMES_DASHBOARD_PASSWORD,
  };
  process.env.HERMES_DASHBOARD_URL = "https://dashboard.example";
  process.env.HERMES_DASHBOARD_USERNAME = "operator";
  process.env.HERMES_DASHBOARD_PASSWORD = "not-a-real-password";

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/password-login")) {
      return {
        ok: true,
        status: 200,
        headers: { getSetCookie: () => ["session=test; Path=/; HttpOnly"] },
        text: async () => "",
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ columns: [{ name: "triage", tasks: [{ id: "t_live", status: "triage" }] }, { name: "done", tasks: [{ id: "t_done", status: "done" }] }] }),
    };
  };

  try {
    const { kanbanGetBoard } = await import(`./dashboard-client.mjs?test=${Date.now()}`);
    const board = await kanbanGetBoard("default");
    assert.deepEqual(board.columns.map((column) => column.name), ["triage", "done"]);
    assert.match(calls[1].url, /\/api\/plugins\/kanban\/board\?board=default/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HERMES_DASHBOARD_URL = originalEnv.url;
    process.env.HERMES_DASHBOARD_USERNAME = originalEnv.username;
    process.env.HERMES_DASHBOARD_PASSWORD = originalEnv.password;
  }
});
