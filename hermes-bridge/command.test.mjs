import assert from "node:assert/strict";
import test from "node:test";
import { formatHermesCommandError } from "./command.mjs";

test("reports a dispatch timeout instead of an opaque command failure", () => {
  const error = Object.assign(new Error("Command failed: hermes -z inspect portal"), {
    code: "ETIMEDOUT",
    killed: true,
    signal: "SIGTERM",
  });

  assert.match(
    formatHermesCommandError(error, 900000),
    /timed out after 15 minutes/i,
  );
});

test("preserves Hermes stderr when the command exits with an error", () => {
  const error = Object.assign(new Error("Command failed"), {
    stderr: "HTTP 429: The usage limit has been reached\n",
  });

  assert.equal(
    formatHermesCommandError(error, 900000),
    "HTTP 429: The usage limit has been reached",
  );
});
