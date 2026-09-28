import assert from "node:assert/strict";
import test from "node:test";
import { requiresApproval } from "./dispatch-policy";

test("allows read-only and drafting work to queue automatically", () => {
  assert.equal(requiresApproval("oneshot", "Summarize today's tasks and draft a follow-up email."), false);
});

test("requires approval for external actions even when the client marks them safe", () => {
  assert.equal(requiresApproval("oneshot", "Send this email to the client."), true);
  assert.equal(requiresApproval("oneshot", "Publish this post to LinkedIn."), true);
});

test("requires approval for every cron mutation", () => {
  assert.equal(requiresApproval("cron.pause", "Pause the daily summary"), true);
  assert.equal(requiresApproval("cron.run", "Run the weekly reset now"), true);
});
