import assert from "node:assert/strict";
import test from "node:test";
import { completedTaskCount, deriveAgentActivity } from "./agent-activity.mjs";

test("derives agent card activity from canonical assigned kanban tasks", () => {
  const activity = deriveAgentActivity([
    { id: "1", assignee: "builder", title: "Ship the landing page", status: "done", completed_at: 100, updated_at: 90 },
    { id: "2", assignee: "builder", title: "Fix the mobile menu", status: "running", started_at: 110, updated_at: 109 },
    { id: "3", assignee: "ops", title: "Unrelated task", status: "done", completed_at: 120 },
  ], "jbt", { builder: "jbt", ops: "integgy" });

  assert.deepEqual(activity, [
    { timestamp: new Date(110_000).toISOString(), action: "Working: Fix the mobile menu" },
    { timestamp: new Date(100_000).toISOString(), action: "Completed: Ship the landing page" },
  ]);
});

test("uses an honest status label for blocked and queued tasks", () => {
  const activity = deriveAgentActivity([
    { id: "1", assignee: "personal", title: "Plan the week", status: "blocked", updated_at: 100 },
    { id: "2", assignee: "personal", title: "Review notes", status: "ready", updated_at: 200 },
  ], "josh", { personal: "josh" });

  assert.equal(activity[0].action, "Queued: Review notes");
  assert.equal(activity[1].action, "Blocked: Plan the week");
});

test("counts completed canonical tasks for the card and office badge", () => {
  const tasks = [
    { assignee: "builder", status: "done" },
    { assignee: "builder", status: "completed" },
    { assignee: "builder", status: "running" },
    { assignee: "ops", status: "done" },
  ];
  assert.equal(completedTaskCount(tasks, "jbt", { builder: "jbt", ops: "integgy" }), 2);
});
