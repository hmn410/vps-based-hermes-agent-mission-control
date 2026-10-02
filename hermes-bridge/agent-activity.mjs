const TERMINAL = new Set(["done", "completed", "archived"]);

function timestampFor(task) {
  const value = task.completed_at ?? task.last_heartbeat_at ?? task.started_at ?? task.updated_at ?? task.created_at;
  if (value === null || value === undefined) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const milliseconds = new Date(String(value)).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function actionFor(task) {
  const status = String(task.status || "").toLowerCase();
  const prefix = TERMINAL.has(status) ? "Completed" : status === "blocked" ? "Blocked" : status === "running" ? "Working" : "Queued";
  return `${prefix}: ${task.title || "Untitled task"}`;
}

export function completedTaskCount(tasks, agentId, assigneeToAgent) {
  return tasks.filter((task) =>
    assigneeToAgent[task.assignee] === agentId && TERMINAL.has(String(task.status || "").toLowerCase())
  ).length;
}

// Produce the agent-card feed from the same canonical kanban snapshot used for
// status. This keeps it useful even when no one opened an HQ chat modal.
export function deriveAgentActivity(tasks, agentId, assigneeToAgent, limit = 10) {
  return tasks
    .filter((task) => assigneeToAgent[task.assignee] === agentId)
    .map((task) => ({ timestampMs: timestampFor(task), action: actionFor(task) }))
    .filter((entry) => entry.timestampMs !== null)
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, limit)
    .map(({ timestampMs, action }) => ({ timestamp: new Date(timestampMs).toISOString(), action }));
}
