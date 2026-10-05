import assert from "node:assert/strict";
import test from "node:test";
import { extractFollowUps, latestCompletedRunMetadata } from "./follow-up.mjs";

test("completed task with explicit follow-up metadata yields human follow-ups", () => {
  // Real shapes seen in kanban task_runs.metadata (t_41c6c4d8, t_ed81b527).
  assert.deepEqual(extractFollowUps({ needs_confirmation: ["madewithkate.com Coming Soon"], findings: ["x"] }), [
    "Needs your confirmation: madewithkate.com Coming Soon",
  ]);
  assert.deepEqual(extractFollowUps(JSON.stringify({ deploy_required: true, changed_files: ["a.ts"] })), [
    "Deploy required (VPS host)",
  ]);
  assert.deepEqual(
    extractFollowUps({ follow_up: [{ title: "Approve DNS change" }, "Reply to client"], action_required: "Rotate API key" }),
    ["Approve DNS change", "Reply to client", "Action required: Rotate API key"],
  );
});

test("no follow-up is inferred from free text or informational metadata", () => {
  assert.deepEqual(extractFollowUps({ summary: "Josh should follow up with the client", next_steps_priority: ["a"] }), []);
  assert.deepEqual(extractFollowUps({ deploy_required: false, needs_confirmation: [] }), []);
  assert.deepEqual(extractFollowUps(null), []);
  assert.deepEqual(extractFollowUps("not json"), []);
});

test("uses the latest completed run's metadata, ignoring blocked/reclaimed runs", () => {
  const runs = [
    { id: 1, outcome: "completed", ended_at: 10, metadata: { deploy_required: true } },
    { id: 2, outcome: "blocked", ended_at: 20, metadata: { needs_confirmation: ["stale"] } },
    { id: 3, outcome: "completed", ended_at: 30, metadata: { needs_confirmation: ["current"] } },
  ];
  assert.deepEqual(latestCompletedRunMetadata(runs), { needs_confirmation: ["current"] });
  assert.equal(latestCompletedRunMetadata([]), null);
});
