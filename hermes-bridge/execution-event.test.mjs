import assert from "node:assert/strict";
import test from "node:test";
import { enrichExecutionEventPayload } from "./execution-event.mjs";

test("adds task telemetry to a detail-free heartbeat without replacing source fields", () => {
  assert.deepEqual(
    JSON.parse(enrichExecutionEventPayload({ kind: "heartbeat", payload: null }, { current_step_key: "run tests", worker_pid: 42, current_run_id: 7 })),
    { current_step_key: "run tests", worker_pid: 42, current_run_id: 7 },
  );
  assert.deepEqual(
    JSON.parse(enrichExecutionEventPayload({ kind: "heartbeat", payload: JSON.stringify({ tool: "terminal" }) }, { current_step_key: "run tests", worker_pid: 42, current_run_id: 7 })),
    { tool: "terminal", current_step_key: "run tests", worker_pid: 42, current_run_id: 7 },
  );
});

test("leaves non-heartbeat payloads unchanged", () => {
  const payload = JSON.stringify({ summary: "done" });
  assert.equal(enrichExecutionEventPayload({ kind: "completed", payload }, { current_step_key: "ignored" }), payload);
});
