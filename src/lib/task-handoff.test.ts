import assert from "node:assert/strict";
import test from "node:test";
import { deriveTaskHandoff, parseHandoffText, type TaskDetailPayload } from "./task-handoff";

// A worker that comments a full multi-line command handoff, then blocks.
const HANDOFF_COMMENT = [
  "Rollout handoff for Josh.",
  "",
  "Where: VPS host shell (prompt `root@srv1998556`, not inside a Hermes container)",
  "",
  "```bash",
  "cd /docker/hermes-agent-mnis/data/home/hermy-hq",
  "",
  "git status --short",
  "git push origin main",
  "",
  "docker compose build --no-cache app hermes-bridge",
  "docker compose up -d --force-recreate app hermes-bridge",
  "```",
  "",
  "Expected: both app and hermes-bridge show running; logs have no startup errors.",
  "After: unblock this task; the worker re-checks /api/hermes/health and the Tasks page.",
].join("\n");

function blockedDetail(overrides: Partial<TaskDetailPayload> = {}): TaskDetailPayload {
  return {
    task: { id: "t_1", status: "blocked", result: null, latest_summary: null },
    comments: [
      { id: 1, author: "builder", body: "Old attempt note\n```bash\nrm -rf /should/not/appear\n```", created_at: 100 },
      { id: 2, author: "builder", body: HANDOFF_COMMENT, created_at: 510 },
    ],
    events: [
      { id: 1, kind: "created", payload: null, created_at: 90, run_id: null },
      { id: 2, kind: "claimed", payload: null, created_at: 95, run_id: 1 },
      { id: 3, kind: "blocked", payload: { reason: "first", kind: "needs_input" }, created_at: 110, run_id: 1 },
      { id: 4, kind: "unblocked", payload: null, created_at: 400, run_id: null },
      { id: 5, kind: "claimed", payload: null, created_at: 500, run_id: 2 },
      { id: 6, kind: "blocked", payload: { reason: "Deploy needs your approval on the VPS host.", kind: "needs_input" }, created_at: 520, run_id: 2 },
    ],
    runs: [
      { id: 1, status: "blocked", outcome: "blocked", started_at: 95, ended_at: 110, summary: null, metadata: null },
      { id: 2, status: "blocked", outcome: "blocked", started_at: 500, ended_at: 520, summary: null, metadata: null },
    ],
    ...overrides,
  };
}

test("blocked task: multi-line command handoff from a comment survives verbatim and in order", () => {
  const h = deriveTaskHandoff(blockedDetail(), "needs_input");
  assert.equal(h.trigger, "blocked");
  assert.equal(h.state, "exact");
  assert.equal(h.why, "Deploy needs your approval on the VPS host.");
  assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0].lang, "bash");
  assert.equal(
    h.commands[0].code,
    [
      "cd /docker/hermes-agent-mnis/data/home/hermy-hq",
      "",
      "git status --short",
      "git push origin main",
      "",
      "docker compose build --no-cache app hermes-bridge",
      "docker compose up -d --force-recreate app hermes-bridge",
    ].join("\n"),
  );
  assert.match(h.where ?? "", /VPS host shell/);
  assert.match(h.expected ?? "", /both app and hermes-bridge show running/);
  assert.match(h.after ?? "", /unblock this task/);
  assert.deepEqual(h.missing, []);
  assert.match(h.hqNext, /Nothing runs automatically/);
  // Full, untruncated source text is kept (well past the 280-char preview).
  const comment = h.sources.find((s) => s.kind === "comment");
  assert.equal(comment?.text, HANDOFF_COMMENT);
  assert.ok(HANDOFF_COMMENT.length > 280);
  // Comments from the earlier, already-unblocked attempt are history.
  assert.ok(!h.commands.some((c) => c.code.includes("rm -rf")));
});

test("blocked task with no recorded commands is an explicit absence, never invented steps", () => {
  const h = deriveTaskHandoff(blockedDetail({ comments: [{ id: 9, author: "ops", body: "Need a decision on the DNS provider.", created_at: 515 }] }), "needs_input");
  assert.equal(h.state, "absent");
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.steps, []);
  assert.equal(h.why, "Deploy needs your approval on the VPS host.");
  assert.ok(h.missing.includes("commands_or_steps"));
  assert.ok(h.missing.includes("where") && h.missing.includes("expected") && h.missing.includes("after"));
  assert.equal(h.where, null);
});

test("detail with no comments, runs, or reason still yields a safe absent handoff", () => {
  const h = deriveTaskHandoff({ task: { status: "blocked" }, events: [{ id: 1, kind: "blocked", payload: null, created_at: 1 }] });
  assert.equal(h.trigger, "blocked");
  assert.equal(h.state, "absent");
  assert.ok(h.missing.includes("why"));
  assert.deepEqual(h.sources, []);
  assert.equal(deriveTaskHandoff({}).trigger, "none");
});

test("a block that was already cleared is not a handoff", () => {
  const d = blockedDetail();
  d.task = { ...d.task, status: "running" };
  d.events = [...(d.events ?? []), { id: 7, kind: "unblocked", payload: null, created_at: 600 }, { id: 8, kind: "claimed", payload: null, created_at: 610 }];
  const h = deriveTaskHandoff(d, "none");
  assert.equal(h.trigger, "none");
  assert.deepEqual(h.commands, []);
});

test("repeat block (triage + block_loop_detected without a reason) uses the prior blocked reason", () => {
  const h = deriveTaskHandoff({
    task: { status: "triage" },
    events: [
      { id: 1, kind: "claimed", created_at: 10 },
      { id: 2, kind: "blocked", payload: { reason: "Needs the Hostinger key added in hPanel." }, created_at: 20 },
      { id: 3, kind: "block_loop_detected", payload: { recurrences: 2 }, created_at: 21 },
    ],
    comments: [{ id: 1, author: "builder", body: "Steps:\n1. Open hPanel → SSH Access\n2. Add the hermes-builder public key\nExpected: key listed as active", created_at: 15 }],
  }, "repeat_block");
  assert.equal(h.trigger, "blocked");
  assert.equal(h.why, "Needs the Hostinger key added in hPanel.");
  assert.equal(h.state, "exact");
  assert.deepEqual(h.steps, ["Open hPanel → SSH Access", "Add the hermes-builder public key"]);
  assert.equal(h.expected, "key listed as active");
});

test("done follow-up: full completion summary commands are surfaced (not the board preview)", () => {
  const summary = `Fix committed locally.\n\nRun on the VPS host:\n\n\`\`\`bash\ncd /docker/x\ngit push origin main\n\`\`\`\n\nExpected result: push succeeds.`;
  const h = deriveTaskHandoff({
    task: { status: "done", result: summary.slice(0, 200), latest_summary: summary },
    runs: [{ id: 3, status: "done", outcome: "completed", started_at: 50, ended_at: 90, summary, metadata: { deploy_required: true, changed_files: ["a.ts"] } }],
    comments: [],
    events: [],
  }, "follow_up");
  assert.equal(h.trigger, "follow_up");
  assert.equal(h.why, "Deploy required (VPS host)");
  assert.equal(h.commands[0]?.code, "cd /docker/x\ngit push origin main");
  assert.equal(h.expected, "push succeeds.");
  assert.match(h.hqNext, /will not retry/);
});

test("structured `handoff` metadata is used verbatim", () => {
  const h = deriveTaskHandoff({
    task: { status: "done" },
    runs: [{ id: 1, outcome: "completed", ended_at: 5, summary: "done", metadata: {
      action_required: "Rebuild the app",
      handoff: { commands: ["docker compose up -d app"], where: "VPS host", expected: "app running", after: "archive the card" },
    } }],
  }, "follow_up");
  assert.equal(h.state, "exact");
  assert.equal(h.commands[0].code, "docker compose up -d app");
  assert.equal(h.where, "VPS host");
  assert.equal(h.after, "archive the card");
});

test("done task without follow-up metadata is informational, not a handoff", () => {
  const h = deriveTaskHandoff({
    task: { status: "done" },
    runs: [{ id: 1, outcome: "completed", ended_at: 5, summary: "```bash\necho hi\n```", metadata: { findings: ["x"] } }],
  }, "none");
  assert.equal(h.trigger, "none");
  assert.deepEqual(h.commands, []);
});

test("parseHandoffText keeps tilde fences, unterminated fences, and ignores labels inside code", () => {
  const p = parseHandoffText("~~~sh\nexport A=1\nWhere: not a label\n~~~\n```\nlast line");
  assert.deepEqual(p.commands.map((c) => c.code), ["export A=1\nWhere: not a label", "last line"]);
  assert.equal(p.labels.where, undefined);
});
