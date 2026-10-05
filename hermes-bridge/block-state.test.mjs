import assert from "node:assert/strict";
import test from "node:test";
import { deriveBlockState, needsBlockDetail } from "./block-state.mjs";

// Real Hermes sequence (t_7306f3c3): blocked -> unblocked -> re-block of the same
// kind routes the task to `triage` with `block_loop_detected` (BLOCK_RECURRENCE_LIMIT=2).
const blockedTwice = [
  { id: 936, kind: "blocked", created_at: 100, payload: JSON.stringify({ reason: "First question", kind: "needs_input", recurrences: 1 }) },
  { id: 937, kind: "unblocked", created_at: 110, payload: null },
  { id: 938, kind: "claimed", created_at: 111, payload: "{}" },
  { id: 945, kind: "block_loop_detected", created_at: 120, payload: { reason: "Second, current question", kind: "needs_input", recurrences: 2, limit: 2 } },
];

test("task blocked twice surfaces the latest reason, not the stale first one", () => {
  const s = deriveBlockState([...blockedTwice].reverse()); // order-independent
  assert.equal(s.blockReason, "Second, current question");
  assert.equal(s.blockEventKind, "block_loop_detected");
  assert.equal(s.blockedAt, 120);
  assert.equal(s.blockCount, 2);
});

test("a block followed by unblock/claim is history, not the current state", () => {
  const s = deriveBlockState(blockedTwice.slice(0, 3));
  assert.equal(s.blockReason, null);
  assert.equal(s.blockEventKind, null);
  assert.equal(s.blockCount, 1);
});

test("auto-specifier edits after a loop block do not hide the current block", () => {
  const s = deriveBlockState([...blockedTwice, { id: 950, kind: "specified", created_at: 130, payload: "{}" }]);
  assert.equal(s.blockReason, "Second, current question");
});

test("only parked tasks with block history need per-task detail", () => {
  assert.equal(needsBlockDetail({ status: "blocked" }), true);
  assert.equal(needsBlockDetail({ status: "triage", block_kind: "needs_input", block_recurrences: 2 }), true);
  assert.equal(needsBlockDetail({ status: "triage", block_kind: null, block_recurrences: 0 }), false);
  assert.equal(needsBlockDetail({ status: "running", block_kind: "needs_input", block_recurrences: 1 }), false);
});
