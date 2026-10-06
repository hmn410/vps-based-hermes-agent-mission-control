import assert from "node:assert/strict";
import test from "node:test";
import { isAgentActivelyWorking } from "./agent-activity";

const running = { assignee: "builder", status: "running" };

test("glows only for a working agent with a running task for its profile", () => {
  assert.equal(isAgentActivelyWorking("working", "builder", [running]), true);
});

test("queued, blocked or in-review work is not active", () => {
  for (const status of ["triage", "todo", "ready", "review", "blocked", "done", "archived"]) {
    assert.equal(isAgentActivelyWorking("working", "builder", [{ assignee: "builder", status }]), false, status);
  }
});

test("another profile's running task does not light this agent", () => {
  assert.equal(isAgentActivelyWorking("working", "builder", [{ assignee: "ops", status: "running" }]), false);
});

test("idle, online (gateway connected), offline and error agents never glow", () => {
  for (const s of ["idle", "online", "offline", "error"]) {
    assert.equal(isAgentActivelyWorking(s, "builder", [running]), false, s);
    assert.equal(isAgentActivelyWorking(s, "builder", null), false, s);
  }
});

test("clears as soon as the running task leaves running", () => {
  assert.equal(isAgentActivelyWorking("working", "builder", [running]), true);
  assert.equal(isAgentActivelyWorking("working", "builder", [{ ...running, status: "done" }]), false);
  assert.equal(isAgentActivelyWorking("idle", "builder", [{ ...running, status: "done" }]), false);
});

test("falls back to live bridge status when the task mirror is unavailable", () => {
  assert.equal(isAgentActivelyWorking("working", "builder", null), true);
});

test("unknown profile with a task feed is never active", () => {
  assert.equal(isAgentActivelyWorking("working", undefined, [running]), false);
});
