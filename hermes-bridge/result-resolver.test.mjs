import assert from "node:assert/strict";
import test from "node:test";
import { resolveMirroredTaskResult, resolveTaskResult } from "./result-resolver.mjs";

test("prefers a completed run summary when the task result is empty", () => {
  assert.equal(
    resolveTaskResult({ result: null }, [{ status: "done", summary: "The answer from Hermes." }]),
    "The answer from Hermes.",
  );
});

test("prefers the explicit task result over a run summary", () => {
  assert.equal(
    resolveTaskResult(
      { result: "Final task result." },
      [{ status: "done", summary: "Older run summary." }],
    ),
    "Final task result.",
  );
});

test("uses a completed-event summary when neither task nor run has output", () => {
  assert.equal(
    resolveTaskResult(
      { result: null },
      [],
      [{ kind: "completed", payload: JSON.stringify({ summary: "Event completion summary." }) }],
    ),
    "Event completion summary.",
  );
});

test("returns the existing completion fallback only when Hermes gave no output", () => {
  assert.equal(resolveTaskResult({ result: null }, [], []), "Task completed on the kanban board.");
});

test("uses a completed-event summary for a completed mirrored task", () => {
  assert.equal(
    resolveMirroredTaskResult(
      { status: "done", result: null },
      [],
      [{ kind: "completed", payload: JSON.stringify({ summary: "Completed from event." }) }],
    ),
    "Completed from event.",
  );
});

test("does not invent a completion result for an active mirrored task", () => {
  assert.equal(resolveMirroredTaskResult({ status: "running", result: null }), null);
});
