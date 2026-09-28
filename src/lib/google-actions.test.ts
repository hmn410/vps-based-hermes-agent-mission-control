import assert from "node:assert/strict";
import test from "node:test";
import { classifyGoogleAction } from "./google-actions";

test("gmail reading and drafting never require approval", () => {
  assert.equal(classifyGoogleAction("gmail.list").requiresApproval, false);
  assert.equal(classifyGoogleAction("gmail.get").requiresApproval, false);
  assert.equal(classifyGoogleAction("gmail.draft").requiresApproval, false);
});

test("gmail send and modify always require approval", () => {
  assert.equal(classifyGoogleAction("gmail.send").requiresApproval, true);
  assert.equal(classifyGoogleAction("gmail.reply").requiresApproval, true);
  assert.equal(classifyGoogleAction("gmail.modify").requiresApproval, true);
  assert.equal(classifyGoogleAction("gmail.trash").requiresApproval, true);
});

test("calendar reading never requires approval, all mutation does", () => {
  assert.equal(classifyGoogleAction("calendar.list").requiresApproval, false);
  assert.equal(classifyGoogleAction("calendar.create").requiresApproval, true);
  assert.equal(classifyGoogleAction("calendar.update").requiresApproval, true);
  assert.equal(classifyGoogleAction("calendar.delete").requiresApproval, true);
});

test("unknown action kinds fail closed (require approval)", () => {
  assert.equal(classifyGoogleAction("gmail.somethingnew").requiresApproval, true);
  assert.equal(classifyGoogleAction("unknown.kind").requiresApproval, true);
});
