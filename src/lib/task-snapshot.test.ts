import assert from "node:assert/strict";
import test from "node:test";
import { keepLastKnownSnapshot } from "./task-snapshot";

test("keeps known task history when a refresh transiently reports an empty list", () => {
  const previous = [{ id: "t_1" }];
  const outcome = keepLastKnownSnapshot(previous, [], false);
  assert.deepEqual(outcome.items, previous);
  assert.equal(outcome.stale, true);
});

test("accepts a non-empty refreshed task list", () => {
  const outcome = keepLastKnownSnapshot([{ id: "t_1" }], [{ id: "t_2" }], false);
  assert.deepEqual(outcome.items, [{ id: "t_2" }]);
  assert.equal(outcome.stale, false);
});

test("accepts an explicitly confirmed empty board", () => {
  const outcome = keepLastKnownSnapshot([{ id: "t_1" }], [], true);
  assert.deepEqual(outcome.items, []);
  assert.equal(outcome.stale, false);
});
