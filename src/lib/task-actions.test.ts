import assert from "node:assert/strict";
import test from "node:test";
import { actionErrorMessage, markRemoved, withoutPendingRemovals, type PendingRemovals } from "./task-actions";

const tasks = [{ id: "t_1" }, { id: "t_2" }, { id: "t_3" }];

test("hides only the archived task while the mirror still returns it", () => {
  const pending: PendingRemovals = new Map();
  markRemoved(pending, "t_2", 1_000);
  assert.deepEqual(withoutPendingRemovals(tasks, pending, 2_000), [{ id: "t_1" }, { id: "t_3" }]);
  // Still pending: a later stale poll must not resurrect it.
  assert.equal(pending.has("t_2"), true);
  assert.deepEqual(withoutPendingRemovals(tasks, pending, 3_000), [{ id: "t_1" }, { id: "t_3" }]);
});

test("clears the pending entry once the mirror stops returning the task", () => {
  const pending: PendingRemovals = new Map();
  markRemoved(pending, "t_2", 1_000);
  const synced = [{ id: "t_1" }, { id: "t_3" }];
  assert.deepEqual(withoutPendingRemovals(synced, pending, 2_000), synced);
  assert.equal(pending.size, 0);
});

test("expires stale pending removals so a card is never hidden forever", () => {
  const pending: PendingRemovals = new Map();
  markRemoved(pending, "t_2", 1_000, 5_000);
  assert.deepEqual(withoutPendingRemovals(tasks, pending, 6_000), tasks);
  assert.equal(pending.size, 0);
});

test("no pending removals returns the snapshot unchanged", () => {
  assert.equal(withoutPendingRemovals(tasks, new Map()), tasks);
});

test("surfaces the API error text on failure", async () => {
  const res = new Response(JSON.stringify({ error: "status transition to 'archived' not valid" }), { status: 500 });
  assert.equal(await actionErrorMessage(res), "status transition to 'archived' not valid");
});

test("falls back to the status code for non-JSON failures", async () => {
  assert.equal(await actionErrorMessage(new Response("gateway down", { status: 502 })), "Request failed (502)");
});
