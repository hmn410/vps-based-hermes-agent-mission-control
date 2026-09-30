import assert from "node:assert/strict";
import test from "node:test";
import { agentForProfile, profileForAgent } from "./agent-roster";

test("uses the human-facing HQ names as stable agent IDs", () => {
  assert.equal(profileForAgent("hermes"), "default");
  assert.equal(profileForAgent("integgy"), "ops");
  assert.equal(profileForAgent("jbt"), "builder");
  assert.equal(profileForAgent("josh"), "personal");
  assert.equal(profileForAgent("pixel"), "seocontent");
});

test("maps Hermes profiles back to their HQ agent IDs", () => {
  assert.equal(agentForProfile("default"), "hermes");
  assert.equal(agentForProfile("builder"), "jbt");
});
