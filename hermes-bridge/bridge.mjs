#!/usr/bin/env node
/**
 * Hermy HQ ↔ Hermes bridge.
 *
 * Talks to Postgres (the same DATABASE_URL the website uses) and to the
 * Hermes gateway's built-in OpenAI-compatible API server over plain HTTP
 * (API_SERVER_ENABLED=true on the Hermes container — see
 * https://hermes-agent.nousresearch.com/docs, "API server"). No shared
 * /opt/data volume, no shelling into a local `hermes` CLI, no risk of
 * touching the live agent's session/state files concurrently — this
 * container only ever makes network calls, like any other API client.
 *
 *   PULL  (Hermes → website): chief-of-staff daily brief into DataStore,
 *         cron jobs via GET /api/jobs into DataStore, kanban tasks mirrored
 *         from a READ-ONLY bind mount into HermesTask, emit activity events.
 *   PUSH  (website → Hermes): pick up AgentRequest rows that are `queued`
 *         (safe) or `approved` (human-approved side-effecting), run them
 *         through the Hermes API server, and write results back. Cron
 *         create/pause/resume/remove/run mutations call the API server's
 *         REST /api/jobs directly (no CLI needed).
 *
 * Requires env: DATABASE_URL, HERMES_API_URL (e.g. http://hermes-agent:8642),
 *               HERMES_API_KEY (matches API_SERVER_KEY on the Hermes side).
 * Optional env: BRIDGE_POLL_MS (5000), BRIDGE_MIRROR_MS (30000),
 *               KANBAN_DB_PATH (/hermes-ro/kanban.db, read-only mount).
 *
 * NOTE: Memory Wiki was removed from Hermy HQ entirely — it required a Mac
 * mini-style always-on local machine to write markdown files, which this
 * VPS/Docker deployment doesn't have, and Hermes's API server has no write
 * endpoint for the wiki either (memory_write_api is hard-disabled
 * server-side). If it's ever wanted again, either build a small write API
 * on the Hermes side, or use chat with the agent directly ("remember X")
 * — that writes ~/.hermes/wiki/*.md immediately, no dashboard needed.
 */
import pg from "pg";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { formatHermesCommandError } from "./command.mjs";
import { claimRequest } from "./queue.mjs";
import DatabaseConstructor from "better-sqlite3";

const API_URL = (process.env.HERMES_API_URL || "http://127.0.0.1:8642").replace(/\/+$/, "");
const API_KEY = process.env.HERMES_API_KEY || "";
const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 5000);
const MIRROR_MS = Number(process.env.BRIDGE_MIRROR_MS || 30000);
const RUN_TIMEOUT_MS = Number(process.env.BRIDGE_RUN_TIMEOUT_MS || 900000);
const KANBAN_DB_PATH = process.env.KANBAN_DB_PATH || "/hermes-ro/kanban.db";
if (!API_KEY) { console.error("HERMES_API_KEY is required (matches API_SERVER_KEY on the Hermes container)"); process.exit(1); }

const BRIEF_HOUR = Number(process.env.BRIEF_HOUR || 8); // local hour to auto-generate the daily brief
const BRIEF_PROMPT =
  "You are the operator's chief of staff for personal life and JoshBuilds.Tech. Produce today's morning brief. " +
  "Read the kanban board and recent activity if available to you as tools. Do not invent work-account data or claim inbox/calendar access. " +
  "Work follow-ups may only come from tasks explicitly recorded by the operator. Output ONLY valid JSON (no prose, no code fences) " +
  'in exactly this shape: {"greeting":"one warm line","summary":"2-3 sentences on where things stand",' +
  '"sections":[{"label":"Today’s tasks","items":["..."]},{"label":"Personal follow-ups","items":["..."]},' +
  '{"label":"JoshBuilds priorities","items":["..."]},{"label":"Work follow-ups to review","items":["..."]},' +
  '{"label":"Needs your approval","items":["..."]},{"label":"Next actions","items":["..."]}]}. ' +
  "Keep every item short, concrete, and specific. Omit a section if it has nothing.";
let lastBriefDate = null;

const DB_URL = process.env.DATABASE_URL || "";
if (!DB_URL) { console.error("DATABASE_URL is required (use the direct postgres:// URL, not a prisma:// Accelerate URL)"); process.exit(1); }
if (DB_URL.startsWith("prisma://") || DB_URL.startsWith("prisma+")) {
  console.error("DATABASE_URL is a Prisma Accelerate URL; the bridge needs a DIRECT postgres:// connection string (e.g. POSTGRES_URL).");
  process.exit(1);
}
// Cloud Postgres (Prisma Postgres/Neon/Supabase/RDS) needs SSL; local/Docker Postgres does not.
// In Docker Compose the database hostname is normally the service name, "postgres".
const dbHost = (() => { try { return new URL(DB_URL).hostname; } catch { return ""; } })();
const isLocal = new Set(["localhost", "127.0.0.1", "postgres"]).has(dbHost);
const pool = new pg.Pool({ connectionString: DB_URL, max: 4, ssl: isLocal ? undefined : { rejectUnauthorized: false } });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const q = (text, params) => pool.query(text, params);

// One-shot prompt → plain-text reply via Hermes's OpenAI-compatible API.
async function hermesChat(prompt, { timeout = RUN_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
      body: JSON.stringify({ model: "hermes-agent", messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Hermes API ${res.status}: ${body.slice(0, 300)}`);
      err.stderr = body;
      throw err;
    }
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || "").trim();
  } finally {
    clearTimeout(t);
  }
}

// Thin JSON wrapper over the Hermes API server's REST endpoints (cron jobs).
async function hermesApi(method, urlPath, body) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const err = new Error(`Hermes API ${method} ${urlPath} → ${res.status}: ${text.slice(0, 300)}`);
    err.stderr = text;
    throw err;
  }
  return data;
}

async function emit(kind, title, { detail = null, agent = "hermes", level = "info", meta = null } = {}) {
  await q(
    `INSERT INTO "AgentEvent" (id, kind, title, detail, agent, level, meta, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
    [randomUUID(), kind, title.slice(0, 200), detail, agent, level, meta ? JSON.stringify(meta) : null]
  );
}

async function setStore(key, data) {
  await q(
    `INSERT INTO "DataStore" (key, data, "updatedAt") VALUES ($1,$2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, "updatedAt" = now()`,
    [key, JSON.stringify(data)]
  );
}

async function mirrorHealth() {
  let online = false;
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(8000) });
    online = res.ok;
  } catch { /* offline */ }
  await setStore("hermes-health", { online, gateway: online ? "running" : "stopped", lastSeen: new Date().toISOString() });
}

/* ─────────────── Cron mirror (GET /api/jobs, no mount needed) ─────────────── */
function formatCronLine(j) {
  const state = j.enabled === false ? "paused" : (j.state || "scheduled");
  const lines = [`  ${j.id} [${state}]`];
  lines.push(`    Name: ${j.name || ""}`);
  lines.push(`    Schedule: ${j.schedule_display || j.schedule?.display || ""}`);
  if (j.next_run_at) lines.push(`    Next run: ${j.next_run_at}`);
  if (j.last_run_at) lines.push(`    Last run: ${j.last_run_at} ${j.last_status || ""}`.trim());
  if (j.deliver) lines.push(`    Deliver: ${j.deliver}`);
  if (Array.isArray(j.skills) && j.skills.length) lines.push(`    Skills: ${j.skills.join(", ")}`);
  if (j.script) lines.push(`    Script: ${j.script}`);
  if (j.mode) lines.push(`    Mode: ${j.mode}`);
  return lines.join("\n");
}
async function mirrorCrons() {
  const data = await hermesApi("GET", "/api/jobs");
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const raw = jobs.map(formatCronLine).join("\n");
  await setStore("hermes-crons", { raw, syncedAt: new Date().toISOString() });
}

/* ─────────────── Kanban mirror (read-only sqlite mount) ─────────────── */
function readKanbanTasks() {
  if (!fs.existsSync(KANBAN_DB_PATH)) return [];
  // Plain readonly open: needs the sibling -wal/-shm files to exist as
  // regular files (not the DB itself being writable) for SQLite's WAL
  // locking bytes. compose.yaml must bind-mount all three by exact path —
  // if a sibling doesn't exist on the host yet, Docker silently creates a
  // DIRECTORY there instead of failing, which corrupts the real files for
  // every other consumer of this same DB. Never mount a WAL/SHM path that
  // doesn't already exist as a plain file on the host.
  const db = new DatabaseConstructor(KANBAN_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(
      `SELECT id, title, status, assignee, priority, result FROM tasks ORDER BY status ASC, priority DESC LIMIT 200`
    ).all();
  } finally {
    db.close();
  }
}
async function mirrorKanban() {
  let rows;
  try { rows = readKanbanTasks(); } catch (e) { log("kanban read err", e.message); return; }
  for (const t of rows) {
    await q(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, "updatedAt", "syncedAt")
       VALUES ($1,'default',$2,$3,$4,$5,$6, now(), now())
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, assignee=EXCLUDED.assignee,
         status=EXCLUDED.status, priority=EXCLUDED.priority, result=EXCLUDED.result,
         "updatedAt"=now(), "syncedAt"=now()`,
      [t.id, t.title, t.assignee, t.status, t.priority ?? 0, t.result ?? null]
    );
  }
  // Drop mirrored rows for tasks that no longer exist on the board (archived/purged).
  const ids = rows.map((t) => t.id);
  await q(`DELETE FROM "HermesTask" WHERE board='default' AND NOT (id = ANY($1::text[]))`, [ids.length ? ids : [""]]);
}

/* ─────────────── Chief-of-staff daily brief ─────────────── */
async function generateBriefing() {
  const raw = (await hermesChat(BRIEF_PROMPT)).trim();
  let brief;
  try {
    const jsonStr = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const m = jsonStr.match(/\{[\s\S]*\}/);
    brief = JSON.parse(m ? m[0] : jsonStr);
  } catch { brief = { summary: raw.slice(0, 1500), sections: [] }; }
  brief.generatedAt = new Date().toISOString();
  await setStore("hermes-briefing", brief);
  await emit("status", "Daily brief generated", { level: "up" });
}
async function maybeDailyBrief() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() >= BRIEF_HOUR && lastBriefDate !== today) {
    lastBriefDate = today;
    try { await generateBriefing(); } catch (e) { log("daily brief err", e.message); }
  }
}

/* ─────────────── PUSH: run website requests via Hermes ─────────────── */
async function runRequest(r) {
  if (!await claimRequest(q, r.id)) return;
  await emit("run", `Started: ${r.title}`, { level: "info", meta: { requestId: r.id, kind: r.kind } });
  try {
    let result = "";
    if (r.kind === "oneshot" || r.kind === "chat") {
      result = (await hermesChat(r.prompt || r.title)).trim();
    } else if (r.kind === "briefing.generate") {
      await generateBriefing();
      lastBriefDate = new Date().toISOString().slice(0, 10);
      result = "brief updated";
    } else if (r.kind === "gmail.summarize") {
      const { prompt, total } = JSON.parse(r.prompt || "{}");
      const raw = (await hermesChat(prompt)).trim();
      let summary = raw;
      try {
        const jsonStr = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
        const m = jsonStr.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(m ? m[0] : jsonStr);
        if (parsed.summary) summary = parsed.summary;
      } catch { /* fall back to raw text */ }
      await setStore("gmail-overview", { total, summary, generatedAt: new Date().toISOString() });
      result = "inbox overview updated";
    } else if (r.kind.startsWith("cron.")) {
      const op = r.kind.slice("cron.".length);
      const b = JSON.parse(r.prompt || "{}");
      if (op === "create") {
        await hermesApi("POST", "/api/jobs", { name: b.name, prompt: b.prompt, schedule: b.schedule, deliver: b.deliver });
      } else if (op === "remove") {
        await hermesApi("DELETE", `/api/jobs/${b.id}`);
      } else if (op === "pause") {
        await hermesApi("POST", `/api/jobs/${b.id}/pause`);
      } else if (op === "resume") {
        await hermesApi("POST", `/api/jobs/${b.id}/resume`);
      } else if (op === "run") {
        await hermesApi("POST", `/api/jobs/${b.id}/run`);
      } else if (op === "edit") {
        await hermesApi("PATCH", `/api/jobs/${b.id}`, b.patch || {});
      } else {
        throw new Error(`unknown cron op ${op}`);
      }
      await mirrorCrons();
      result = `cron ${op} ok`;
    } else {
      throw new Error(`unknown kind ${r.kind}`);
    }
    await q(`UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
      [r.id, result.slice(0, 8000)]);
    await emit("run", `Done: ${r.title}`, { level: "up", detail: result.slice(0, 400), meta: { requestId: r.id } });
  } catch (e) {
    const msg = formatHermesCommandError(e, RUN_TIMEOUT_MS);
    await q(`UPDATE "AgentRequest" SET status='failed', error=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id, msg]);
    await emit("run", `Failed: ${r.title}`, { level: "down", detail: msg, meta: { requestId: r.id } });
    log("request failed:", r.id, msg);
  }
}

async function processQueue() {
  const { rows } = await q(
    `SELECT * FROM "AgentRequest" WHERE status IN ('queued','approved') ORDER BY "createdAt" ASC LIMIT 3`
  );
  for (const r of rows) await runRequest(r);
}

/* ─────────────── loops ─────────────── */
async function mirrorTick() {
  try { await mirrorHealth(); } catch (e) { log("mirrorHealth err", e.message); }
  try { await mirrorCrons(); } catch (e) { log("mirrorCrons err", e.message); }
  try { await mirrorKanban(); } catch (e) { log("mirrorKanban err", e.message); }
  try { await maybeDailyBrief(); } catch (e) { log("maybeDailyBrief err", e.message); }
}

async function main() {
  log(`hermes-bridge up (HTTP mode) · api=${API_URL} · poll=${POLL_MS}ms · mirror=${MIRROR_MS}ms`);
  await emit("status", "Bridge connected", { level: "up" });
  await mirrorTick();
  setInterval(() => mirrorTick().catch((e) => log("mirror loop", e.message)), MIRROR_MS);
  // queue loop
  const tick = async () => { try { await processQueue(); } catch (e) { log("queue loop", e.message); } finally { setTimeout(tick, POLL_MS); } };
  tick();
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });
