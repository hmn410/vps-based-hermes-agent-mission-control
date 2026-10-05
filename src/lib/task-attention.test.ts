import assert from "node:assert/strict";
import test from "node:test";
import { deriveTaskAttention } from "./task-attention";

test("task blocked twice (Hermes routes it to triage + block_loop_detected) is a repeat block that needs you", () => {
  const a = deriveTaskAttention({
    status: "triage",
    blockKind: "needs_input",
    blockRecurrences: 2,
    blockCount: 2,
    blockEventKind: "block_loop_detected",
    blockReason: "Second, current question",
    lastFailureError: null,
  });
  assert.equal(a.kind, "repeat_block");
  assert.equal(a.needsYou, true);
  assert.equal(a.column, "blocked");
  assert.equal(a.reason, "Second, current question");
  assert.equal(a.recurrences, 2);
  assert.equal(a.canUnblock, true);
  assert.match(a.label, /Blocked again \(2×\)/);
});

test("current reason beats stale legacy lastFailureError JSON", () => {
  const a = deriveTaskAttention({
    status: "blocked", blockKind: "needs_input", blockReason: "New reason",
    lastFailureError: JSON.stringify({ reason: "Old first-run reason" }),
  });
  assert.equal(a.reason, "New reason");
  const legacy = deriveTaskAttention({ status: "blocked", blockKind: "needs_input", lastFailureError: '{"reason":"Only legacy"}' });
  assert.equal(legacy.reason, "Only legacy");
});

test("needs_input is action-required; capability is distinct from it", () => {
  const input = deriveTaskAttention({ status: "blocked", blockKind: "needs_input" });
  assert.equal(input.kind, "needs_input");
  assert.equal(input.label, "Needs your input");
  assert.equal(input.needsYou, true);
  const cap = deriveTaskAttention({ status: "blocked", blockKind: "capability" });
  assert.equal(cap.kind, "capability");
  assert.notEqual(cap.label, input.label);
});

test("review is informational, never approval/action-required", () => {
  const a = deriveTaskAttention({ status: "review", blockKind: "needs_input", blockRecurrences: 1 });
  assert.equal(a.kind, "review");
  assert.equal(a.needsYou, false);
});

test("historical block_kind on a resumed task is not a current block", () => {
  for (const status of ["running", "ready", "triage"]) {
    const a = deriveTaskAttention({ status, blockKind: "needs_input", blockRecurrences: 1, blockEventKind: null });
    assert.equal(a.needsYou, false, status);
  }
});

test("dependency wait does not need a human", () => {
  const a = deriveTaskAttention({ status: "todo", blockKind: "dependency", blockEventKind: "dependency_wait" });
  assert.equal(a.kind, "dependency");
  assert.equal(a.needsYou, false);
});
