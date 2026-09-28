import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { readKanbanTaskRows } from "./kanban-reader.mjs";
import { resolveMirroredTaskResult } from "./result-resolver.mjs";

test("finds a task's completed-event summary even when it is outside the live event feed", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT, status TEXT, assignee TEXT, priority INTEGER, result TEXT,
      started_at INTEGER, completed_at INTEGER, worker_pid INTEGER, worker_started_at TEXT,
      last_heartbeat_at INTEGER, current_run_id INTEGER, block_kind TEXT, current_step_key TEXT,
      last_failure_error TEXT
    );
    CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, status TEXT, summary TEXT, ended_at INTEGER);
    CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER);
  `);
  db.prepare("INSERT INTO tasks (id, title, status, priority) VALUES (?, ?, ?, ?)").run("t_old", "Older task", "done", 0);
  db.prepare("INSERT INTO task_events VALUES (?, ?, ?, ?, ?, ?)").run(1, "t_old", null, "completed", JSON.stringify({ summary: "Older completion output." }), 1);
  const insertNoise = db.prepare("INSERT INTO task_events VALUES (?, ?, ?, ?, ?, ?)");
  for (let id = 2; id <= 200; id += 1) insertNoise.run(id, `noise_${id}`, null, "heartbeat", null, id);

  const task = readKanbanTaskRows(db).find((row) => row.id === "t_old");
  assert.equal(task.completed_event_payload, JSON.stringify({ summary: "Older completion output." }));
  assert.equal(
    resolveMirroredTaskResult(task, [{ summary: task.run_summary }], [{ kind: "completed", payload: task.completed_event_payload }]),
    "Older completion output.",
  );
  db.close();
});
