import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUpcomingWorkday, nextWorkday, isIsoDate } from "./upcoming-workday";

test("rejects non-objects and bad dates", () => {
  assert.equal(typeof sanitizeUpcomingWorkday(null), "string");
  assert.equal(typeof sanitizeUpcomingWorkday([]), "string");
  assert.equal(typeof sanitizeUpcomingWorkday({ forDate: "2026-13-40" }), "string");
  assert.equal(typeof sanitizeUpcomingWorkday({ forDate: "tomorrow" }), "string");
});

test("keeps only known fields, trims, and caps sizes", () => {
  const r = sanitizeUpcomingWorkday({
    forDate: "2026-10-06",
    evil: "<script>",
    priorities: ["a", " b ", "", "c", "d"],
    risks: Array.from({ length: 50 }, (_, i) => `r${i}`),
    focusBlocks: ["x".repeat(1000)],
    fixedCommitments: [
      "Standup 9am",
      { title: "Client call", time: "2pm", location: "Zoom", extra: "drop" },
      { time: "no title" },
      42,
    ],
  });
  assert.ok(typeof r === "object");
  assert.equal("evil" in r, false);
  assert.deepEqual(r.priorities, ["a", "b", "c"]);
  assert.equal(r.risks.length, 10);
  assert.equal(r.focusBlocks[0].length, 300);
  assert.deepEqual(r.fixedCommitments, [
    { title: "Standup 9am" },
    { title: "Client call", time: "2pm", location: "Zoom" },
  ]);
  assert.deepEqual(r.prepTonight, []);
});

test("isIsoDate", () => {
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2028-02-29"), true);
});

test("nextWorkday skips weekends (Chicago time)", () => {
  // Fri 2026-10-02 20:00 CDT → Mon 10-05
  assert.equal(nextWorkday(new Date("2026-10-03T01:00:00Z")), "2026-10-05");
  // Mon 2026-10-05 10:00 CDT → Tue 10-06
  assert.equal(nextWorkday(new Date("2026-10-05T15:00:00Z")), "2026-10-06");
  // Sat → Mon
  assert.equal(nextWorkday(new Date("2026-10-03T17:00:00Z")), "2026-10-05");
});
