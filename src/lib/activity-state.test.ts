import assert from "node:assert/strict";
import test from "node:test";
import { activityLinks, currentActivityState } from "./activity-state";

const now = new Date("2026-10-06T12:40:00.000Z");
const created = new Date("2026-10-06T12:30:00.000Z");
type Req = { id: string; status: string; createdAt: Date; hermesTaskId?: string | null };
type Task = { id: string; status: string; startedAt?: Date | null; syncedAt?: Date | null; blockEventKind?: string | null; blockReason?: string | null; blockKind?: string | null };
const maps = (requests: Req[], tasks: Task[]) => [new Map(requests.map((r) => [r.id, r])), new Map(tasks.map((t) => [t.id, t]))] as const;
const queuedEvent = { level: "info", meta: { requestId: "r1", taskId: "t_1" } };

test("reads request/task links from event meta defensively", () => {
  assert.deepEqual(activityLinks({ requestId: "r1", taskId: "t_1" }), { requestId: "r1", taskId: "t_1" });
  assert.deepEqual(activityLinks(null), { requestId: null, taskId: null });
  assert.deepEqual(activityLinks(["x"]), { requestId: null, taskId: null });
});

test("a 'Queued as kanban task' event reflects the task's completion", () => {
  const [r, t] = maps([{ id: "r1", status: "done", createdAt: created, hermesTaskId: "t_1" }], []);
  assert.equal(currentActivityState(queuedEvent, r, t, now)?.label, "Done");
});

test("queued event follows the task through ready -> running -> blocked", () => {
  const req = { id: "r1", status: "running", createdAt: created, hermesTaskId: "t_1" };
  let [r, t] = maps([req], [{ id: "t_1", status: "ready", syncedAt: now }]);
  assert.equal(currentActivityState(queuedEvent, r, t, now)?.label, "Queued");
  [r, t] = maps([req], [{ id: "t_1", status: "running", startedAt: now, syncedAt: now }]);
  assert.equal(currentActivityState(queuedEvent, r, t, now)?.label, "Running");
  [r, t] = maps([req], [{ id: "t_1", status: "blocked", blockKind: "needs_input", blockReason: "need a decision", syncedAt: now }]);
  const blocked = currentActivityState(queuedEvent, r, t, now);
  assert.equal(blocked?.status, "blocked");
  assert.equal(blocked?.tone, "down");
});

test("handed-off request whose task is not mirrored yet reads as queued, not running", () => {
  const [r, t] = maps([{ id: "r1", status: "running", createdAt: created, hermesTaskId: "t_1" }], []);
  assert.equal(currentActivityState(queuedEvent, r, t, now)?.status, "waiting_for_dispatch");
});

test("terminal Done/Failed event rows carry no extra state", () => {
  const [r, t] = maps([{ id: "r1", status: "done", createdAt: created }], []);
  assert.equal(currentActivityState({ level: "up", meta: { requestId: "r1" } }, r, t, now), null);
  assert.equal(currentActivityState({ level: "info", meta: null }, r, t, now), null);
});

test("non-kanban request reflects its own status", () => {
  const [r, t] = maps([{ id: "r1", status: "failed", createdAt: created }], []);
  assert.equal(currentActivityState({ level: "info", meta: { requestId: "r1" } }, r, t, now)?.label, "Failed");
});

test("deleted request and archived task say so instead of looking queued", () => {
  const [r, t] = maps([], []);
  assert.equal(currentActivityState(queuedEvent, r, t, now)?.status, "gone");
});
