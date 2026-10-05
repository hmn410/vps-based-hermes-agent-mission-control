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
  // Bounded fan-out: a todo backlog card with a stale human block_kind is not fetched.
  assert.equal(needsBlockDetail({ status: "todo", block_kind: "needs_input", block_recurrences: 2 }), false);
  assert.equal(needsBlockDetail({ status: "todo", block_kind: "dependency" }), true);
});

test("a dashboard drag/direct move (`status` event) after a repeat block clears it", () => {
  const s = deriveBlockState([...blockedTwice, { id: 960, kind: "status", created_at: 140, payload: { status: "todo" } }], "todo");
  assert.equal(s.blockEventKind, null);
  assert.equal(s.blockReason, null);
  assert.equal(s.blockCount, 2); // history is kept
});

for (const kind of ["promoted_manual", "reclaimed", "changes_requested", "review_reopened"]) {
  test(`\`${kind}\` after a block clears the current block`, () => {
    const s = deriveBlockState([...blockedTwice, { id: 970, kind, created_at: 150, payload: "{}" }]);
    assert.equal(s.blockEventKind, null);
  });
}

test("a loop-triaged card re-specified into todo (no `promoted` yet) is no longer a current block", () => {
  const events = [...blockedTwice, { id: 950, kind: "specified", created_at: 130, payload: { changed_fields: ["body"] } }];
  assert.equal(deriveBlockState(events, "todo").blockEventKind, null);
  // ...but while it is still in triage the loop block remains current.
  assert.equal(deriveBlockState(events, "triage").blockEventKind, "block_loop_detected");
});

test("a block is only current while the task sits in the status that block produced", () => {
  const blocked = [{ id: 1, kind: "blocked", created_at: 1, payload: { reason: "Need creds", kind: "capability" } }];
  assert.equal(deriveBlockState(blocked, "blocked").blockReason, "Need creds");
  assert.equal(deriveBlockState(blocked, "ready").blockReason, null);
  const dep = [{ id: 2, kind: "dependency_wait", created_at: 2, payload: { reason: "parent", kind: "dependency" } }];
  assert.equal(deriveBlockState(dep, "todo").blockEventKind, "dependency_wait");
});
