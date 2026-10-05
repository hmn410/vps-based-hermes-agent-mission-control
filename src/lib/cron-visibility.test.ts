import assert from "node:assert/strict";
import test from "node:test";
import { classifyCronJob, isHiddenCron } from "./cron-visibility";

test("personal jobs stay visible and actionable", () => {
  assert.equal(classifyCronJob({ name: "Melatonin reminder", deliver: "photon" }), "personal");
  assert.equal(classifyCronJob({ name: "Weekly relevant AgentSkills scan", deliver: "photon" }), "personal");
  assert.equal(isHiddenCron({ name: "Melatonin reminder", deliver: "photon" }), false);
});

test("employer-work jobs are hidden", () => {
  assert.equal(classifyCronJob({ name: "Weekday next-day Integris planning check-in", deliver: "origin" }), "work");
  assert.equal(classifyCronJob({ name: "MSP client sweep" }), "work");
  assert.equal(classifyCronJob({ name: "Workday planning nudge" }), "work");
  assert.equal(classifyCronJob({ name: "Morning check", prompt: "Summarize my open tickets" }), "work");
  // Word boundaries: unrelated words containing the letters do not match.
  assert.equal(classifyCronJob({ name: "Homework planner for kids", deliver: "photon" }), "personal");
});

test("HQ plumbing jobs are system jobs", () => {
  assert.equal(classifyCronJob({ name: "kanban-mirror-snapshot", deliver: "local" }), "system");
  assert.equal(classifyCronJob({ name: "Kanban task digest — needs-you and done batching", deliver: "local" }), "system");
  assert.equal(classifyCronJob({ name: "kanban-anything", deliver: "photon" }), "system");
  assert.equal(isHiddenCron({ name: "kanban-mirror-snapshot", deliver: "local" }), true);
});
