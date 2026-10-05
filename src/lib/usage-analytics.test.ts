import assert from "node:assert/strict";
import test from "node:test";
import { mergeModelRows, shapeAnalytics, totalsFromRows } from "./usage-analytics";

// Shape of the real upstream payload that produced "$137.72 total < $141.40
// claude-sonnet-5 row": upstream totals only cover the sessions table, while
// models[] also contains an aux-usage row (here the $26.78 one).
const upstream = {
  period_days: 30,
  totals: {
    distinct_models: 2, total_input: 1_700_000, total_output: 1_400_000, total_cache_read: 0,
    total_reasoning: 0, total_estimated_cost: 137.72, total_actual_cost: 0, total_sessions: 467, total_api_calls: 3_300,
  },
  models: [
    { model: "claude-sonnet-5", provider: "anthropic", input_tokens: 1_667_130, output_tokens: 1_357_667, estimated_cost: 111.41, sessions: 233, api_calls: 3197 },
    { model: "claude-sonnet-5", provider: "openai-codex", input_tokens: 4_410_467, output_tokens: 10, estimated_cost: 3.21, sessions: 1, api_calls: 10 },
    { model: "claude-sonnet-5", provider: "anthropic", input_tokens: 1100, output_tokens: 520_107, estimated_cost: 26.78, sessions: 19, api_calls: 550 },
    { model: "gpt-5.6-terra", provider: "openai-codex", input_tokens: 12_119_252, output_tokens: 5, estimated_cost: 23.1, sessions: 234, api_calls: 3000 },
    { model: "GPT-5.6-terra", provider: "", input_tokens: 0, output_tokens: 0, estimated_cost: 0, sessions: 2, api_calls: 0 },
  ],
};

test("total cost tile is never smaller than any model row", () => {
  const shaped = shapeAnalytics(upstream);
  const maxRow = Math.max(...shaped.models.map((m) => m.estimated_cost ?? 0));
  assert.ok(shaped.totals.total_estimated_cost >= maxRow);
  const rowSum = shaped.models.reduce((s, m) => s + (m.estimated_cost ?? 0), 0);
  assert.equal(shaped.totals.total_estimated_cost.toFixed(2), rowSum.toFixed(2));
  assert.equal(shaped.totals.total_estimated_cost.toFixed(2), "164.50");
  assert.equal(shaped.totals_source, "rows");
  // Upstream sessions-only totals are preserved for reference, not displayed as the tile.
  assert.equal((shaped.session_totals as { total_estimated_cost: number }).total_estimated_cost, 137.72);
  // Sessions are not additive across aux rows: keep the upstream distinct count.
  assert.equal(shaped.totals.total_sessions, 467);
});

test("rows sharing a model name merge case-insensitively and totals follow", () => {
  const rows = mergeModelRows(upstream.models);
  assert.equal(rows.length, 2);
  const sonnet = rows.find((r) => r.model === "claude-sonnet-5")!;
  assert.equal(sonnet.provider, "anthropic");
  assert.equal(sonnet.sessions, 253);
  assert.equal(Number(sonnet.estimated_cost).toFixed(2), "141.40");
  const totals = totalsFromRows(rows);
  assert.equal(totals.distinct_models, 2);
  assert.equal(totals.total_sessions, 489);
  assert.equal(totals.total_api_calls, 6757);
  assert.equal(totals.total_input, 1_667_130 + 4_410_467 + 1100 + 12_119_252);
});

test("missing models yields zero totals instead of upstream numbers", () => {
  const shaped = shapeAnalytics({ totals: { total_estimated_cost: 5 } });
  assert.deepEqual(shaped.models, []);
  assert.equal(shaped.totals.total_estimated_cost, 0);
  assert.equal(shaped.totals.distinct_models, 0);
});
