import assert from "node:assert/strict";
import test from "node:test";
import { ideaDisplayStatus, isBacklogStatus, sendBlocker } from "./idea-status";

test("backlog statuses display as themselves", () => {
  assert.equal(ideaDisplayStatus({ status: "new" }), "new");
  assert.equal(ideaDisplayStatus({ status: null }), "new");
  assert.equal(ideaDisplayStatus({ status: "considering" }), "considering");
  assert.equal(ideaDisplayStatus({ status: "rejected", kanbanTaskId: "t_1" }), "rejected");
});

test("legacy approved / in-progress / done map to Sent with a task, else Considering", () => {
  for (const status of ["approved", "in-progress", "done"]) {
    assert.equal(ideaDisplayStatus({ status, kanbanTaskId: "t_abc" }), "sent");
    assert.equal(ideaDisplayStatus({ status, kanbanTaskId: null }), "considering");
  }
});

test("a linked task always reads as Sent", () => {
  assert.equal(ideaDisplayStatus({ status: "sent", kanbanTaskId: "t_9" }), "sent");
  assert.equal(ideaDisplayStatus({ status: "new", kanbanTaskId: "t_9" }), "sent");
  assert.equal(ideaDisplayStatus({ status: "sent" }), "considering");
});

test("only backlog statuses are writable", () => {
  assert.ok(isBacklogStatus("considering"));
  assert.ok(!isBacklogStatus("approved"));
  assert.ok(!isBacklogStatus("sent"));
});

test("send is blocked for vague, already-sent, or rejected ideas", () => {
  assert.match(sendBlocker({ status: "new", description: "fix it" }) ?? "", /real description/);
  assert.match(sendBlocker({ status: "new", kanbanTaskId: "t_1", description: "x".repeat(40) }) ?? "", /already sent/);
  assert.match(sendBlocker({ status: "rejected", description: "x".repeat(40) }) ?? "", /Reopen/);
  assert.equal(sendBlocker({ status: "considering", description: "Add a dark-mode toggle to the JBT site header." }), null);
});
