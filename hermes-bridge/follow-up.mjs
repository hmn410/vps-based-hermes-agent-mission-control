// Explicit "Josh must follow up" signals on a COMPLETED kanban task.
//
// Hermes has no first-class follow-up field: kanban_complete(summary,
// metadata) stores free-form `metadata` on the closing task_run
// (hermes_cli/kanban_db.py complete_task -> _end_run). HQ therefore defines a
// small, explicit contract over that metadata and mirrors ONLY these keys —
// it never infers a follow-up from the free-text summary/result.
//
// Recognised completion-metadata keys (on the latest completed run):
//   follow_up / follow_ups / human_follow_up   string | string[] | {title|text|action}[]
//   action_required                            string | string[] | true
//   needs_confirmation                         string | string[] | true
//   deploy_required                            true | string   (Josh deploys from the VPS host)
//   approval_required / needs_approval         true | string | string[]
// Anything else (findings, next_steps_priority, notes, ...) is informational.

const LIST_KEYS = [
  ["follow_up", null],
  ["follow_ups", null],
  ["human_follow_up", null],
  ["action_required", "Action required"],
  ["needs_confirmation", "Needs your confirmation"],
  ["approval_required", "Needs your approval"],
  ["needs_approval", "Needs your approval"],
  ["deploy_required", "Deploy required (VPS host)"],
];

function itemText(value) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    for (const key of ["title", "text", "action", "summary", "description"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
  }
  return null;
}

function parseMetadata(metadata) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) return metadata;
  if (typeof metadata !== "string" || !metadata.trim()) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {object|string|null} metadata completion metadata of the latest completed run
 * @returns {string[]} human follow-up items, deduped, each <= 500 chars; [] when none
 */
export function extractFollowUps(metadata) {
  const meta = parseMetadata(metadata);
  if (!meta) return [];
  const items = [];
  for (const [key, label] of LIST_KEYS) {
    const value = meta[key];
    if (value == null || value === false || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (value === true) {
      if (label) items.push(label);
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      const text = itemText(v);
      if (text) items.push(label ? `${label}: ${text}` : text);
    }
  }
  return [...new Set(items.map((s) => s.slice(0, 500)))].slice(0, 20);
}

/** Latest completed run's metadata from a dashboard GET /tasks/:id payload. */
export function latestCompletedRunMetadata(runs = []) {
  const completed = (Array.isArray(runs) ? runs : [])
    .filter((run) => run && (run.outcome === "completed" || run.status === "done"))
    .sort((a, b) => (Number(a.ended_at || 0) - Number(b.ended_at || 0)) || (Number(a.id || 0) - Number(b.id || 0)));
  return completed.length ? completed[completed.length - 1].metadata ?? null : null;
}
