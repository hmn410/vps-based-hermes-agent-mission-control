import assert from "node:assert/strict";
import test from "node:test";
import { createDetailCache, detailEvents, detailSignature, mapLimit, mergeEventRows } from "./task-detail.mjs";

test("detail cache refetches only when the card changes or the TTL lapses", () => {
  let now = 0;
  const cache = createDetailCache({ activeTtlMs: 1000, terminalTtlMs: 5000, now: () => now });
  const card = { id: "t1", status: "running", current_run_id: 7, last_heartbeat_at: 100, comment_count: 1 };
  cache.set(card, { ok: 1 });
  assert.deepEqual(cache.get(card), { ok: 1 });
  // New comment -> signature change -> refetch.
  assert.equal(cache.get({ ...card, comment_count: 2 }), null);
  // New heartbeat -> refetch.
  assert.equal(cache.get({ ...card, last_heartbeat_at: 160 }), null);
  now = 1500;
  assert.equal(cache.get(card), null, "active TTL lapsed");
  cache.set({ id: "t2", status: "done" }, { done: 1 });
  now = 4000;
  assert.deepEqual(cache.get({ id: "t2", status: "done" }), { done: 1 });
  cache.retain(["t2"]);
  assert.equal(cache.size, 1);
  assert.notEqual(detailSignature(card), detailSignature({ ...card, status: "blocked" }));
});

test("mapLimit never exceeds the concurrency cap and preserves order", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
});

test("detail events become snapshot-shaped rows with a comment preview", () => {
  const rows = detailEvents("t1", {
    events: [
      { id: 10, task_id: "t1", kind: "commented", payload: { author: "worker", len: 12 }, created_at: 100, run_id: null },
      { id: 11, task_id: "t1", kind: "heartbeat", payload: null, created_at: 101, run_id: 5 },
    ],
    comments: [{ author: "worker", body: "Please  add\nX", created_at: 100 }],
  });
  assert.equal(rows[0].payload, JSON.stringify({ author: "worker", len: 12, body_preview: "Please add X" }));
  assert.equal(rows[1].payload, null);
  assert.equal(rows[1].run_id, 5);
});

test("merge dedupes by canonical id, prefers richer payload, newest first even when ids arrive out of order", () => {
  const snapshot = [
    { id: 5, task_id: "t", kind: "commented", payload: '{"author":"a","len":3}', created_at: 50 },
    { id: 3, task_id: "t", kind: "heartbeat", payload: null, created_at: 52 },
  ];
  const live = [
    { id: 5, task_id: "t", kind: "commented", payload: '{"author":"a","len":3,"body_preview":"hey"}', created_at: 50 },
    { id: 7, task_id: "t", kind: "block_loop_detected", payload: '{"reason":"again"}', created_at: 60 },
    { id: 6, task_id: "t", kind: "unblocked", payload: null, created_at: 55 },
  ];
  const merged = mergeEventRows(live, snapshot);
  assert.deepEqual(merged.map((e) => e.id), [7, 6, 3, 5]);
  assert.match(merged.find((e) => e.id === 5).payload, /body_preview/);
});
