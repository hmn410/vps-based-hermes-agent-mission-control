import assert from "node:assert/strict";
import test from "node:test";
import { activeTasks, activityForTask, describeExecutionEvent, projectExecutionFeed, telemetryHealth } from "./live-work";

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
