import assert from "node:assert/strict";
import test from "node:test";
import { DISPATCH_ATTENTION_MS, deriveRequestLifecycle } from "./kanban-request-lifecycle";

const now = new Date("2026-09-29T16:00:00.000Z");
const request = { status: "running", hermesTaskId: "t_1", createdAt: new Date(now.getTime() - 30_000) };

test("ready linked task is queued for dispatcher, never running", () => {
  const lifecycle = deriveRequestLifecycle(request, { id: "t_1", status: "ready", syncedAt: now }, [], now);
  assert.equal(lifecycle.status, "waiting_for_dispatch");
  assert.equal(lifecycle.label, "Queued for dispatcher");
  assert.equal(lifecycle.dispatcherAttention, false);
});

test("stalled ready task asks for dispatcher attention after documented threshold", () => {
  const old = { ...request, createdAt: new Date(now.getTime() - DISPATCH_ATTENTION_MS - 1) };
  const lifecycle = deriveRequestLifecycle(old, { id: "t_1", status: "ready", syncedAt: now }, [], now);
  assert.equal(lifecycle.dispatcherAttention, true);
  assert.equal(lifecycle.queueAgeMs, DISPATCH_ATTENTION_MS + 1);
});

test("running starts only when canonical HermesTask is running", () => {
  const lifecycle = deriveRequestLifecycle(request, { id: "t_1", status: "running", startedAt: now, syncedAt: now }, [], now);
  assert.equal(lifecycle.status, "running");
});

test("canonical completion changes a running request to done", () => {
  const lifecycle = deriveRequestLifecycle(request, { id: "t_1", status: "done", startedAt: now, syncedAt: now }, [], now);
  assert.equal(lifecycle.status, "done");
  assert.equal(lifecycle.label, "Done");
});

test("blocked state includes canonical reason and latest event", () => {
  const lifecycle = deriveRequestLifecycle(
    request,
    { id: "t_1", status: "blocked", lastFailureError: "Need tenant consent", syncedAt: now },
    [{ taskId: "t_1", kind: "blocked", createdAt: now, payload: '{"reason":"Need tenant consent"}' }],
    now,
  );
  assert.equal(lifecycle.status, "blocked");
  assert.equal(lifecycle.blockerReason, "Need tenant consent");
  assert.equal(lifecycle.latestEvent?.kind, "blocked");
});

test("missing mirror retains queued state but flags dispatcher attention", () => {
  const old = { status: "queued", createdAt: new Date(now.getTime() - DISPATCH_ATTENTION_MS - 1), hermesTaskId: "t_missing" };
  const lifecycle = deriveRequestLifecycle(old, null, [], now);
  assert.equal(lifecycle.status, "queued");
  assert.equal(lifecycle.dispatcherAttention, true);
});
