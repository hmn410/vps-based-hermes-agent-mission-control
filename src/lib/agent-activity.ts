/* "Actively working" for the Agents roster glow.

   The bridge marks an agent "working" whenever its profile has ANY open
   kanban task (triage/todo/ready/running/review/blocked). That is the right
   meaning for the existing "Working" pill, but a queued, blocked or
   in-review task is not the agent doing work right now. The glow is reserved
   for an agent that has a task in `running` on the current kanban mirror.

   Inputs are current state only (bridge AgentState + the latest task
   mirror poll) — never historical events or gateway connectivity. When the
   task mirror is unavailable (`tasks === null`) we fall back to the bridge's
   own status so the glow still reflects the live AgentState rather than a
   stale earlier poll. */

export interface ActivityTask {
  assignee: string | null;
  status: string;
}

export function isAgentActivelyWorking(
  agentStatus: string,
  profile: string | undefined,
  tasks: readonly ActivityTask[] | null,
): boolean {
  if (agentStatus !== "working") return false;
  if (tasks === null) return true;
  if (!profile) return false;
  return tasks.some((t) => t.assignee === profile && t.status === "running");
}
