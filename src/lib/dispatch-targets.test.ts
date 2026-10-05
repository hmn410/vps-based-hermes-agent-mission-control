import assert from "node:assert/strict";
import test from "node:test";
import { DISPATCH_TARGETS, dispatchTargetLabel, normalizeDispatchProfile } from "./dispatch-targets";

test("composer targets are the five real Hermes profiles, default first", () => {
  assert.deepEqual(
    DISPATCH_TARGETS.map((t) => t.profile),
    ["default", "ops", "builder", "personal", "seocontent"],
  );
  assert.equal(DISPATCH_TARGETS[0].label, "Hermes (default)");
});

test("known profiles pass through (case/whitespace-insensitive)", () => {
  assert.equal(normalizeDispatchProfile("builder"), "builder");
  assert.equal(normalizeDispatchProfile(" SeoContent "), "seocontent");
  assert.equal(normalizeDispatchProfile("ops"), "ops");
});

test("unknown or missing profiles fall back to default", () => {
  assert.equal(normalizeDispatchProfile(undefined), "default");
  assert.equal(normalizeDispatchProfile(""), "default");
  assert.equal(normalizeDispatchProfile("root"), "default");
  assert.equal(normalizeDispatchProfile(42), "default");
});

test("labels never carry employer wording", () => {
  for (const t of DISPATCH_TARGETS) assert.doesNotMatch(t.label, /integ|ticket|msp/i);
  assert.equal(dispatchTargetLabel(null), "Hermes (default)");
  assert.equal(dispatchTargetLabel("personal"), "personal");
});
