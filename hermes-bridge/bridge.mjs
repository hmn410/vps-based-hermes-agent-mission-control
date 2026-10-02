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
import { kanbanCreateTask, kanbanGetBoard, kanbanGetTask, dashboardConfigured } from "./dashboard-client.mjs";
import { resolveMirroredTaskResult } from "./result-resolver.mjs";
import { readKanbanTaskRows } from "./kanban-reader.mjs";
import { enrichExecutionEventPayload } from "./execution-event.mjs";
import { deriveAgentActivity, completedTaskCount } from "./agent-activity.mjs";
import DatabaseConstructor from "better-sqlite3";

const API_URL = (process.env.HERMES_API_URL || "http://127.0.0.1:8642").replace(/\/+$/, "");
const API_KEY = process.env.HERMES_API_KEY || "";
const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 2000);
const MIRROR_MS = Number(process.env.BRIDGE_MIRROR_MS || 3000);
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

/* ─────────────── Kanban mirror (canonical dashboard API) ─────────────── */
function readKanbanSnapshotTasks() {
  if (!fs.existsSync(KANBAN_DB_PATH)) throw new Error(`kanban snapshot missing: ${KANBAN_DB_PATH}`);
  // Compatibility fallback only: this is a stable rollback-journal snapshot,
  // never the live WAL database.
  const db = new DatabaseConstructor(KANBAN_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return readKanbanTaskRows(db);
  } finally {
    db.close();
  }
}

async function readKanbanTasks() {
  if (!dashboardConfigured()) return readKanbanSnapshotTasks();
  const board = await kanbanGetBoard(process.env.HERMES_BOARD || "default");
  // The dashboard API is the source of truth and excludes archived cards by
  // default. Preserve its lifecycle-column order while flattening for HQ's
  // Postgres projection.
  const rows = (board?.columns || []).flatMap((column) => column.tasks || []);
  // The board-listing endpoint returns a short RESULT PREVIEW per card (for
  // compact board display), not the full answer — that preview (~200 chars)
  // is what was leaking into the website's dispatch answers, truncating them
  // mid-sentence. The full answer actually lives in the task detail's
  // `latest_summary` / `runs[].summary` (kanban_complete's summary field,
  // not task.result, which stays null unless a worker sets it explicitly).
  // For finished tasks, fetch the canonical full detail so the mirror (and
  // the dispatch chat downstream) gets the complete answer.
  const TERMINAL = new Set(["done", "completed", "archived"]);
  await Promise.all(
    rows
      .filter((t) => TERMINAL.has(String(t.status || "").toLowerCase()))
      .map(async (t) => {
        try {
          const full = await kanbanGetTask(t.id);
          const runSummary = full?.runs?.[full.runs.length - 1]?.summary;
          const fullAnswer = full?.task?.result || full?.task?.latest_summary || runSummary;
          if (fullAnswer) t.result = fullAnswer;
        } catch (e) {
          log("kanban full-task fetch err", t.id, e.message);
        }
      })
  );
  return rows;
}
// Recent task_events (claimed/spawned/heartbeat/commented/completed/blocked/...)
// — the live "what's it doing" feed. Kanban timestamps are unix seconds.
function readKanbanEvents(limit = 150) {
  if (!fs.existsSync(KANBAN_DB_PATH)) throw new Error(`kanban snapshot missing: ${KANBAN_DB_PATH}`);
  const db = new DatabaseConstructor(KANBAN_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(
      `SELECT id, task_id, run_id, kind, payload, created_at
       FROM task_events ORDER BY id DESC LIMIT ?`
    ).all(limit);
  } finally {
    db.close();
  }
}
const toDate = (unixSecs) => (unixSecs ? new Date(unixSecs * 1000) : null);

function boundedError(error) {
  return String(error?.message || error || "unknown kanban event read error").slice(0, 300);
}

async function updateKanbanMirror(patch) {
  const { rows } = await q(`SELECT data FROM "DataStore" WHERE key='hermes-kanban-mirror'`);
  let current = {};
  try { current = rows[0]?.data ? JSON.parse(rows[0].data) : {}; } catch { /* replace malformed metadata */ }
  await setStore("hermes-kanban-mirror", { ...current, ...patch });
}

// ── Agent status derived from REAL kanban task state ──────────────────
// Fixes the Agents tab showing agents stuck on "idle" for work they're
// actually doing: previously "working" was only ever set client-side by
// the chat modal's POST, so delegated tasks (Max spawning a child task via
// kanban_create) never touched AgentState at all, and status never reset
// if the modal/tab was closed. This instead reflects whatever the kanban
// board actually shows, every mirror tick (independent of the browser).
const ASSIGNEE_TO_AGENT = { default: "hermes", ops: "integgy", builder: "jbt", personal: "josh", seocontent: "pixel" };
const ACTIVE_STATUSES = new Set(["triage", "todo", "ready", "running", "review", "blocked"]);
async function syncAgentStates(rows) {
  const activeByAssignee = new Map();
  for (const t of rows) {
    if (!ACTIVE_STATUSES.has(t.status)) continue;
    const agentId = ASSIGNEE_TO_AGENT[t.assignee];
    if (!agentId) continue;
    if (!activeByAssignee.has(agentId)) activeByAssignee.set(agentId, t.title);
  }
  for (const agentId of Object.values(ASSIGNEE_TO_AGENT)) {
    const currentTask = activeByAssignee.get(agentId) || null;
    const status = currentTask ? "working" : "idle";
    // Cards used to read a JSON field that was only written by the optional
    // chat modal, so real kanban work never appeared as agent activity.
    const activity = deriveAgentActivity(rows, agentId, ASSIGNEE_TO_AGENT);
    const latestActivity = activity[0]?.timestamp || null;
    const tasksCompleted = completedTaskCount(rows, agentId, ASSIGNEE_TO_AGENT);
    await q(
      `INSERT INTO "AgentState" (id, name, status, "currentTask", "lastActive", "tasksCompleted", "recentActivity", "updatedAt")
       VALUES ($1,$1,$2,$3,$4,$5,$6::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET status=$2, "currentTask"=$3,
         "lastActive"=COALESCE($4::timestamptz, "AgentState"."lastActive"),
         "tasksCompleted"=$5,
         "recentActivity"=CASE WHEN jsonb_array_length($6::jsonb)>0 THEN $6::jsonb ELSE "AgentState"."recentActivity" END,
         "updatedAt"=now()`,
      [agentId, status, currentTask, latestActivity, tasksCompleted, JSON.stringify(activity)]
    );
  }
}

async function mirrorKanban() {
  let rows;
  try { rows = await readKanbanTasks(); } catch (e) {
    log("kanban read err", e.message);
    await updateKanbanMirror({
      availability: "unavailable",
      eventAvailability: "unavailable",
      eventError: boundedError(e),
    });
    return;
  }
  await updateKanbanMirror({
    sourceReadAt: new Date().toISOString(),
    taskCount: rows.length,
    confirmedEmpty: rows.length === 0,
  });
  try { await syncAgentStates(rows); } catch (e) { log("syncAgentStates err", e.message); }
  let events;
  try {
    events = readKanbanEvents();
    await updateKanbanMirror({
      availability: "available",
      eventAvailability: "available",
      lastSuccessfulEventReadAt: new Date().toISOString(),
      newestEventId: events[0]?.id ?? null,
      eventError: null,
    });
  } catch (e) {
    log("kanban events read err", e.message);
    await updateKanbanMirror({
      availability: "unavailable",
      eventAvailability: "unavailable",
      eventError: boundedError(e),
    });
    events = [];
  }
  const eventsByTask = new Map();
  for (const event of events) {
    const bucket = eventsByTask.get(event.task_id) || [];
    bucket.push(event);
    eventsByTask.set(event.task_id, bucket);
  }
  for (const t of rows) {
    await q(
      `INSERT INTO "HermesTask"
         (id, board, title, assignee, status, priority, result,
          "startedAt", "completedAt", "workerPid", "workerStartedAt",
          "lastHeartbeatAt", "currentRunId", "blockKind", "currentStepKey",
          "lastFailureError", "updatedAt", "syncedAt")
       VALUES ($1,'default',$2,$3,$4,$5,$6, $7,$8,$9,$10,$11,$12,$13,$14, $15, now(), now())
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, assignee=EXCLUDED.assignee,
         status=EXCLUDED.status, priority=EXCLUDED.priority, result=EXCLUDED.result,
         "startedAt"=EXCLUDED."startedAt", "completedAt"=EXCLUDED."completedAt",
         "workerPid"=EXCLUDED."workerPid", "workerStartedAt"=EXCLUDED."workerStartedAt",
         "lastHeartbeatAt"=EXCLUDED."lastHeartbeatAt", "currentRunId"=EXCLUDED."currentRunId",
         "blockKind"=EXCLUDED."blockKind", "currentStepKey"=EXCLUDED."currentStepKey",
         "lastFailureError"=EXCLUDED."lastFailureError",
         "updatedAt"=now(), "syncedAt"=now()`,
      [
        t.id, t.title, t.assignee, t.status, t.priority ?? 0,
        resolveMirroredTaskResult(
          t,
          [{ summary: t.run_summary || t.latest_summary }],
          [{ kind: "completed", payload: t.completed_event_payload }, ...(eventsByTask.get(t.id) || [])],
        ),
        toDate(t.started_at), toDate(t.completed_at), t.worker_pid ?? null, t.worker_started_at ?? null,
        toDate(t.last_heartbeat_at), t.current_run_id ?? null, t.block_kind ?? null, t.current_step_key ?? null,
        t.last_failure_error ?? null,
      ]
    );
  }
  // Drop rows for tasks that no longer exist on the board (archived/purged).
  // This is a completed rollback-journal snapshot, so a successful zero-row
  // read is authoritative. A missing or unreadable snapshot throws above and
  // never reaches this destructive path.
  if (rows.length === 0) {
    await q(`DELETE FROM "HermesTask" WHERE board='default'`);
    return;
  }
  const ids = rows.map((t) => t.id);
  await q(`DELETE FROM "HermesTask" WHERE board='default' AND NOT (id = ANY($1::text[]))`, [ids]);

  const tasksById = new Map(rows.map((task) => [task.id, task]));
  for (const e of events) {
    const task = tasksById.get(e.task_id) || {};
    await q(
      `INSERT INTO "HermesTaskEvent" (id, "taskId", "runId", kind, payload, "createdAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (id) DO NOTHING`,
      [e.id, e.task_id, e.run_id ?? null, e.kind, enrichExecutionEventPayload(e, task), toDate(e.created_at)]
    );
  }
  // Keep the mirrored event log bounded — prune anything older than the newest 500.
  await q(
    `DELETE FROM "HermesTaskEvent" WHERE id NOT IN (SELECT id FROM "HermesTaskEvent" ORDER BY id DESC LIMIT 500)`
  );
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
// oneshot/chat dispatches from the website now become REAL kanban tasks —
// triaged so the configured orchestrator profile picks them up, assigns
// them, and runs them exactly like a Telegram-originated ask. The request
// row is linked via hermesTaskId and its status/result are synced from the
// mirrored HermesTask row by syncKanbanLinkedRequests() below, not written
// here — this function only creates the task and marks the handoff done.
async function runRequest(r) {
  if (!await claimRequest(q, r.id)) return;
  await emit("run", `Started: ${r.title}`, { level: "info", meta: { requestId: r.id, kind: r.kind } });
  try {
    if (r.kind === "oneshot" || r.kind === "chat") {
      if (!dashboardConfigured()) {
        // Fallback: no dashboard credentials configured, run as a plain chat
        // reply like before (no kanban task, no live orchestrator tracking).
        const result = (await hermesChat(r.prompt || r.title)).trim();
        await q(`UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
          [r.id, result.slice(0, 8000)]);
        await emit("run", `Done: ${r.title}`, { level: "up", detail: result.slice(0, 400), meta: { requestId: r.id } });
        return;
      }
      const task = await kanbanCreateTask({
        title: r.title,
        body: [
          r.prompt && r.prompt !== r.title ? r.prompt : r.title,
          "",
          "---",
          "This is a direct question/request from a human via the Hermy HQ dashboard chat — not an internal handoff task. When you finish, call kanban_complete with the FULL, complete answer text in the `summary` field (not a short 1-3 sentence handoff — write out the entire response the human should read, as long as it needs to be).",
          "Do NOT text Josh a completion confirmation — he watches this dashboard live and will see the result here. Do not run `hermes send` for routine completion.",
          "The ONLY exception: if you have to call kanban_block (needs_input/capability/transient — a genuine blocker only you can't resolve without him), a separate digest job will text him about it automatically within a few minutes. You do not need to text him yourself for that either — just block normally with a clear reason.",
        ].join("\n"),
        assignee: r.assignee || "default", // route to the right Hermes profile
        triage: false,                      // skip triage hop — dispatch straight to that
      });
      // Hand off to the kanban lifecycle — leave status as 'running' so it
      // reads as "in flight" on the website; syncKanbanLinkedRequests()
      // takes over from here and mirrors real kanban status/result in.
      await q(`UPDATE "AgentRequest" SET "hermesTaskId"=$2, "updatedAt"=now() WHERE id=$1`, [r.id, task.id]);
      await emit("run", `Queued as kanban task ${task.id}: ${r.title}`, { level: "info", meta: { requestId: r.id, taskId: task.id } });
      return;
    }
    let result = "";
    if (r.kind === "briefing.generate") {
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

/* ─────────────── Sync kanban-linked AgentRequest rows ─────────────── */
// For website dispatches that became kanban tasks: reflect the task's real
// lifecycle (running/blocked/review/done) back onto the AgentRequest row so
// /hermes shows accurate status instead of staying stuck on "running".
const KANBAN_DONE = new Set(["done", "completed", "archived"]);
async function syncKanbanLinkedRequests() {
  const { rows } = await q(
    `SELECT id, "hermesTaskId", "createdAt" FROM "AgentRequest"
     WHERE "hermesTaskId" IS NOT NULL AND status NOT IN ('done','failed','rejected')`
  );
  for (const r of rows) {
    const { rows: taskRows } = await q(`SELECT status, result FROM "HermesTask" WHERE id=$1`, [r.hermesTaskId]);
    const task = taskRows[0];
    if (!task) {
      // Genuinely missing from the mirror. Give the mirror a grace window
      // (a few mirror cycles) in case this was just created and hasn't been
      // picked up yet — but if it's been missing for a while, the kanban
      // task was archived/purged off the board and will NEVER reappear, so
      // leaving this AgentRequest at 'running' forever (as previously
      // happened) is a real bug, not a transient race. Mark it done with an
      // honest note instead of leaving it stuck in the dashboard's "in
      // flight" list indefinitely.
      const ageMs = Date.now() - new Date(r.createdAt).getTime();
      if (ageMs > 2 * 60 * 1000) {
        await q(
          `UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
          [r.id, "This task's kanban card was removed from the board before it could be synced back (e.g. archived during a fix/deploy). No result is available."]
        );
      }
      continue;
    }
    const norm = String(task.status || "").toLowerCase();
    if (KANBAN_DONE.has(norm)) {
      await q(
        `UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
        [r.id, (task.result || "Task completed on the kanban board.").slice(0, 8000)]
      );
    } else if (norm === "blocked") {
      // Surface as a visible status on the website without hard-failing —
      // the task is still alive on the board and can be unblocked there.
      await q(`UPDATE "AgentRequest" SET status='running', "updatedAt"=now() WHERE id=$1`, [r.id]);
    }
    // else: still triage/todo/ready/running/review — leave AgentRequest as 'running'.
  }
}

/* ─────────────── loops ─────────────── */
async function mirrorTick() {
  try { await mirrorHealth(); } catch (e) { log("mirrorHealth err", e.message); }
  try { await mirrorCrons(); } catch (e) { log("mirrorCrons err", e.message); }
  try { await mirrorKanban(); } catch (e) { log("mirrorKanban err", e.message); }
  try { await syncKanbanLinkedRequests(); } catch (e) { log("syncKanbanLinkedRequests err", e.message); }
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
