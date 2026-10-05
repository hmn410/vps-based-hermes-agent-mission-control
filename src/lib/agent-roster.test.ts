import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_ROSTER, agentForProfile, profileForAgent } from "./agent-roster";

test("uses the human-facing HQ names as stable agent IDs", () => {
  assert.equal(profileForAgent("hermes"), "default");
  assert.equal(profileForAgent("integgy"), "ops");
  assert.equal(profileForAgent("jbt"), "builder");
  assert.equal(profileForAgent("josh"), "personal");
  assert.equal(profileForAgent("pixel"), "seocontent");
});

test("roster display names never carry employer wording", () => {
  for (const agent of AGENT_ROSTER) assert.doesNotMatch(agent.name, /integ|ticket|msp/i);
});

test("maps Hermes profiles back to their HQ agent IDs", () => {
  assert.equal(agentForProfile("default"), "hermes");
  assert.equal(agentForProfile("builder"), "jbt");
});
