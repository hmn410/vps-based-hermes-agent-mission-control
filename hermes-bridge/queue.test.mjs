import assert from "node:assert/strict";
import test from "node:test";
import { claimRequest } from "./queue.mjs";

test("claims a queued request exactly once before running it", async () => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 1 };
  };

  assert.equal(await claimRequest(q, "req-1"), true);
  assert.match(calls[0].sql, /WHERE id=\$1 AND status IN \('queued','approved'\)/);
  assert.deepEqual(calls[0].params, ["req-1"]);
});

test("does not run a request another bridge already claimed", async () => {
  const q = async () => ({ rowCount: 0 });
  assert.equal(await claimRequest(q, "req-1"), false);
});
