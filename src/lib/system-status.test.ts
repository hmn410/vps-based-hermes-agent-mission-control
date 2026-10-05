import assert from "node:assert/strict";
import test from "node:test";
import { deriveSystemStatus, formatAge } from "./system-status";

const now = Date.UTC(2026, 9, 5, 22, 0, 0);
const ago = (ms: number) => new Date(now - ms).toISOString();

test("green only when the bridge is fresh, Hermes answers, and the mirror is fresh", () => {
  const s = deriveSystemStatus({ online: true, lastSeen: ago(3_000), mirror: { lastSuccessfulEventReadAt: ago(2_000) } }, now);
  assert.equal(s.level, "up");
  assert.equal(s.text, "Hermes online");
});

test("Hermes API down is red", () => {
  const s = deriveSystemStatus({ online: false, lastSeen: ago(3_000) }, now);
  assert.deepEqual([s.level, s.text], ["down", "Hermes offline"]);
});

test("a silent bridge is red even if its last write said online", () => {
  const s = deriveSystemStatus({ online: true, lastSeen: ago(10 * 60_000) }, now);
  assert.deepEqual([s.level, s.text], ["down", "Bridge silent 10m"]);
});

test("stale kanban mirror is amber with its age", () => {
  const s = deriveSystemStatus({ online: true, lastSeen: ago(1_000), mirror: { lastSuccessfulEventReadAt: ago(5 * 60_000) } }, now);
  assert.deepEqual([s.level, s.text], ["warn", "Mirror stale 5m"]);
});

test("unreachable API and never-reported bridge are red; first load is neutral amber", () => {
  assert.equal(deriveSystemStatus(null, now, true).text, "HQ API unreachable");
  assert.equal(deriveSystemStatus({ online: false, lastSeen: null }, now).text, "Bridge not reporting");
  assert.equal(deriveSystemStatus(undefined, now).level, "warn");
});

test("formatAge", () => {
  assert.equal(formatAge(45_000), "45s");
  assert.equal(formatAge(5 * 60_000), "5m");
  assert.equal(formatAge(27 * 3_600_000), "27h");
  assert.equal(formatAge(3 * 86_400_000), "3d");
});
