import assert from "node:assert/strict";
import test from "node:test";
import { countByState, filterThreads, groupThreads, pageOfThread, paginate, threadState, type ThreadMessage } from "./threads";

function msg(id: string, over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    title: `Request ${id}`,
    prompt: null,
    replyText: null,
    conversationId: null,
    status: "done",
    result: null,
    error: null,
    createdAt: "2026-10-01T10:00:00Z",
    finishedAt: null,
    ...over,
  };
}

test("follow-ups join their original request and order oldest-first", () => {
  const threads = groupThreads([
    msg("b", { conversationId: "a", createdAt: "2026-10-01T12:00:00Z", status: "running" }),
    msg("a", { createdAt: "2026-10-01T10:00:00Z" }),
    msg("c", { createdAt: "2026-10-01T11:00:00Z" }),
  ]);
  assert.deepEqual(threads.map((t) => t.id), ["a", "c"]);
  assert.deepEqual(threads[0].messages.map((m) => m.id), ["a", "b"]);
});

test("thread state follows the latest message", () => {
  assert.equal(threadState({ id: "x", messages: [msg("1"), msg("2", { status: "running" })] }), "active");
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "blocked" })] }), "needs_reply");
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "awaiting_approval" })] }), "needs_reply");
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "queued" })] }), "active");
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "rejected" })] }), "done");
});

test("failed/cancelled conversations are history (Done), not Needs reply", () => {
  for (const status of ["failed", "cancelled", "canceled"]) {
    assert.equal(threadState({ id: "x", messages: [msg("1", { status, error: "boom" })] }), "done", status);
  }
  // A failed follow-up after a done original is still Done.
  assert.equal(threadState({ id: "x", messages: [msg("1"), msg("2", { status: "failed", error: "timeout" })] }), "done");
  // A failed request whose lifecycle carries no current human action stays Done.
  assert.equal(
    threadState({ id: "x", messages: [msg("1", { status: "failed", lifecycle: { attention: { kind: "none", needsYou: false } } })] }),
    "done",
  );
  // A later reply that retried the failure moves the thread on.
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "failed" }), msg("2", { status: "running" })] }), "active");
});

test("current blocks, approvals and explicit follow-ups still need a reply", () => {
  // Lifecycle projects a currently-blocked linked task as `blocked`.
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "blocked", lifecycle: { attention: { kind: "needs_input", needsYou: true } } })] }), "needs_reply");
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "awaiting_approval" })] }), "needs_reply");
  // Done task with explicit completion follow-ups (task-attention follow_up).
  assert.equal(
    threadState({ id: "x", messages: [msg("1", { status: "done", lifecycle: { attention: { kind: "follow_up", needsYou: true } } })] }),
    "needs_reply",
  );
  // A blocked request whose block is no longer current is no longer `blocked`.
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "waiting_for_dispatch", lifecycle: { attention: { kind: "dependency", needsYou: false } } })] }), "active");
});

test("review is informational: Active, not Needs reply", () => {
  assert.equal(threadState({ id: "x", messages: [msg("1", { status: "review", lifecycle: { attention: { kind: "review", needsYou: false } } })] }), "active");
});

test("counts: failed threads no longer inflate Needs reply", () => {
  const threads = groupThreads([
    msg("1", { status: "failed", error: "x" }),
    msg("2", { status: "failed", error: "y" }),
    msg("3", { status: "blocked" }),
    msg("4", { status: "awaiting_approval" }),
    msg("5", { status: "review" }),
  ]);
  assert.deepEqual(countByState(threads), { all: 5, active: 1, needs_reply: 2, done: 2 });
  assert.deepEqual(filterThreads(threads, "needs_reply", "").map((t) => t.id).sort(), ["3", "4"]);
  assert.deepEqual(filterThreads(threads, "done", "").map((t) => t.id).sort(), ["1", "2"]);
});

test("filter + search across title, prompt, replies and results", () => {
  const threads = groupThreads([
    msg("1", { title: "Draft blog post", status: "done" }),
    msg("2", { title: "Fix DNS", status: "running", result: null }),
    msg("3", { title: "Check uptime", status: "blocked", error: "needs the Cloudflare token" }),
  ]);
  assert.equal(filterThreads(threads, "all", "").length, 3);
  assert.deepEqual(filterThreads(threads, "active", "").map((t) => t.id), ["2"]);
  assert.deepEqual(filterThreads(threads, "needs_reply", "cloudflare").map((t) => t.id), ["3"]);
  assert.deepEqual(filterThreads(threads, "all", "BLOG").map((t) => t.id), ["1"]);
  assert.deepEqual(countByState(threads), { all: 3, active: 1, needs_reply: 1, done: 1 });
});

test("pagination clamps and locates a thread's page", () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  assert.deepEqual(paginate(items, 0).items.length, 20);
  assert.equal(paginate(items, 9).page, 2);
  assert.equal(paginate(items, 9).items.length, 5);
  assert.equal(paginate([], 3).pageCount, 1);
  const threads = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, messages: [msg(`m${i}`)] }));
  assert.equal(pageOfThread(threads, "t21"), 1);
  assert.equal(pageOfThread(threads, "m3"), 0);
  assert.equal(pageOfThread(threads, "nope"), -1);
});
