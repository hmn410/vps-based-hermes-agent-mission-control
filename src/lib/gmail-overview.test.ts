import assert from "node:assert/strict";
import test from "node:test";
import { hasGmailData, homePrivacyLine, isSummaryStale } from "./gmail-overview";

const now = Date.UTC(2026, 9, 5, 22, 0, 0);
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

test("summary older than 12h is stale", () => {
  assert.equal(isSummaryStale(hoursAgo(11.9), now), false);
  assert.equal(isSummaryStale(hoursAgo(12.1), now), true);
  assert.equal(isSummaryStale(hoursAgo(27), now), true);
  assert.equal(isSummaryStale(null, now), false);
  assert.equal(isSummaryStale("not a date", now), false);
});

test("only claims Gmail connected when the panel holds Gmail data", () => {
  assert.equal(hasGmailData({ total: 18, summary: "x", generatedAt: hoursAgo(1) }), true);
  assert.equal(hasGmailData({ total: null, summary: null, generatedAt: null }), false);
  assert.equal(hasGmailData(null), false);
  assert.match(homePrivacyLine("connected"), /^Personal Gmail connected · work accounts never connected/);
  assert.match(homePrivacyLine("not_connected"), /^Gmail not connected/);
  assert.doesNotMatch(homePrivacyLine("loading"), /Gmail/);
});
