import assert from "node:assert/strict";
import test from "node:test";
import { DISPATCH_PROFILES, requestAssignee } from "./request-routing.mjs";

test("composer-selected profiles route to that kanban assignee", () => {
  for (const profile of ["default", "ops", "builder", "personal", "seocontent"]) {
    assert.equal(requestAssignee({ assignee: profile }), profile);
  }
  assert.equal(requestAssignee({ assignee: " Builder " }), "builder");
});

test("missing or unknown assignees fall back to the default profile", () => {
  assert.equal(requestAssignee({}), "default");
  assert.equal(requestAssignee(null), "default");
  assert.equal(requestAssignee({ assignee: "" }), "default");
  assert.equal(requestAssignee({ assignee: "integgy" }), "default");
  assert.equal(requestAssignee({ assignee: 7 }), "default");
});

test("bridge and app agree on the dispatch profile set", async () => {
  // Mirror of src/lib/agent-roster.ts profiles (the app's DISPATCH_TARGETS).
  const roster = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/lib/agent-roster.ts", import.meta.url), "utf8"),
  );
  const appProfiles = [...roster.matchAll(/profile:\s*"([a-z]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...DISPATCH_PROFILES].sort(), appProfiles);
});
