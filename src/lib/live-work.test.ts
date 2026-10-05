import assert from "node:assert/strict";
import test from "node:test";
import { activeTasks, activityForTask, describeExecutionEvent, latestActivityAt, mergeTaskEvents, projectExecutionFeed, telemetryHealth } from "./live-work";

// Regression: /live showed a stale "No task events recorded yet" / no new
// updates after comments + heartbeats landed. Representative sequence with
// out-of-order ids (live dashboard vs. snapshot) and an empty stale poll.
test("live activity merges polls newest-first and never regresses to empty", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 18, 0, s)).toISOString();
  type E = { id: number; taskId: string; kind: string; payload: string | null; createdAt: string };
  let held: E[] = mergeTaskEvents<E>([], [
    { id: 10, taskId: "t", kind: "claimed", payload: null, createdAt: at(0) },
    { id: 11, taskId: "t", kind: "heartbeat", payload: null, createdAt: at(10) },
  ]);
  held = mergeTaskEvents(held, [
    // comment has a LOWER id than earlier events but a later timestamp
    { id: 9, taskId: "t", kind: "commented", payload: '{"author":"worker","body_preview":"please add X"}', createdAt: at(20) },
    { id: 12, taskId: "t", kind: "blocked", payload: '{"reason":"need creds","kind":"needs_input"}', createdAt: at(30) },
    { id: 13, taskId: "t", kind: "unblocked", payload: null, createdAt: at(40) },
    { id: 14, taskId: "t", kind: "status", payload: '{"status":"ready"}', createdAt: at(41) },
    { id: 15, taskId: "t", kind: "heartbeat", payload: '{"note":"round 2"}', createdAt: at(50) },
  ]);
  assert.deepEqual(activityForTask(held, "t").map((e) => e.kind),
    ["heartbeat", "status", "unblocked", "blocked", "commented", "heartbeat", "claimed"]);
  // An empty (stale/truncated) poll must not wipe what is shown.
  held = mergeTaskEvents(held, []);
  assert.equal(activityForTask(held, "t").length, 7);
  assert.equal(latestActivityAt(held, "t"), at(50));
  // A poorer duplicate does not erase the comment preview.
  held = mergeTaskEvents(held, [{ id: 9, taskId: "t", kind: "commented", payload: null, createdAt: at(20) }]);
  assert.match(String(held.find((e) => e.id === 9)?.payload), /body_preview/);
  // The second block (after unblock) becomes the newest line.
  held = mergeTaskEvents(held, [{ id: 16, taskId: "t", kind: "block_loop_detected", payload: '{"recurrences":2}', createdAt: at(60) }]);
  assert.equal(activityForTask(held, "t")[0].kind, "block_loop_detected");
  assert.equal(latestActivityAt(held, "missing"), null);
});

test("merge caps retained events to the newest", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, taskId: "t", createdAt: new Date(i * 1000).toISOString() }));
  assert.deepEqual(mergeTaskEvents([], rows, 3).map((e) => e.id), [9, 8, 7]);
});

test("heartbeat notes are shown", () => {
  assert.equal(describeExecutionEvent("heartbeat", '{"note":"Round 2: tracing"}'), "Heartbeat — Round 2: tracing");
});

test("keeps incomplete tasks in the live-work queue", () => {
  const tasks = [
    { id: "done", status: "done" },
    { id: "run", status: "running" },
    { id: "review", status: "review" },
    { id: "archived", status: "archived" },
  ];
  assert.deepEqual(activeTasks(tasks).map((task) => task.id), ["run", "review"]);
});

test("returns one task's activity newest first", () => {
  const events = [{ id: 4, taskId: "other" }, { id: 1, taskId: "work" }, { id: 3, taskId: "work" }];
  assert.deepEqual(activityForTask(events, "work").map((event) => event.id), [3, 1]);
});

test("projects a persistent global feed newest first with a title fallback", () => {
  const feed = projectExecutionFeed([
    { id: 1, taskId: "removed", kind: "completed", payload: null, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, taskId: "active", kind: "blocked", payload: null, createdAt: "2026-01-01T00:01:00.000Z" },
  ], [{ id: "active", title: "Fix the bridge" }]);
  assert.deepEqual(feed.map((event) => [event.id, event.title, event.taskLabel]), [
    [2, "Fix the bridge", "Fix the bridge · active"],
    [1, "removed", "removed"],
  ]);
});

test("distinguishes healthy empty telemetry from unavailable and stale telemetry", () => {
  const now = Date.parse("2026-01-01T00:00:10.000Z");
  assert.deepEqual(telemetryHealth({ eventAvailability: "available", lastSuccessfulEventReadAt: "2026-01-01T00:00:05.000Z", newestEventId: null }, now), {
    available: true, stale: false, lastSuccessfulEventReadAt: "2026-01-01T00:00:05.000Z", newestEventId: null, error: null,
  });
  assert.equal(telemetryHealth({ eventAvailability: "unavailable", eventError: "snapshot missing" }, now).available, false);
  assert.equal(telemetryHealth({ eventAvailability: "available", lastSuccessfulEventReadAt: "2025-12-31T23:59:59.000Z" }, now).stale, true);
});

test("explains heartbeat payloads as the worker's latest work", () => {
  assert.equal(
    describeExecutionEvent("heartbeat", JSON.stringify({ current_step_key: "run tests", tool: "terminal", progress: "3/5" })),
    "Heartbeat — running run tests · terminal · 3/5"
  );
  assert.equal(describeExecutionEvent("heartbeat", null), "Heartbeat — worker is still running; no step detail was reported");
});
