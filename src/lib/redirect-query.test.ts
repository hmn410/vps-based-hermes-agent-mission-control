import assert from "node:assert/strict";
import test from "node:test";
import { withQuery } from "./redirect-query";

test("/live-work redirect lands on the Live tab and keeps deep links", () => {
  assert.equal(withQuery("/tasks", {}, { tab: "live" }), "/tasks?tab=live");
  assert.equal(withQuery("/tasks", { task: "t_1" }, { tab: "live" }), "/tasks?task=t_1&tab=live");
  assert.equal(withQuery("/tasks", { tab: "board" }, { tab: "live" }), "/tasks?tab=live");
});

test("/follow-ups redirect forwards thread selection to /hermes", () => {
  assert.equal(withQuery("/hermes", {}), "/hermes");
  assert.equal(withQuery("/hermes", { thread: "abc", q: ["x", "y"], skip: undefined }), "/hermes?thread=abc&q=x&q=y");
});
