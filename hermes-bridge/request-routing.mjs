// Which Hermes profile (kanban assignee) a website AgentRequest runs on.
// The /hermes composer stores the chosen profile on AgentRequest.assignee
// (validated by src/lib/dispatch-targets.ts in the app). The bridge re-checks
// it here so a row written by any other path can never route work to an
// arbitrary or retired profile: unknown values fall back to "default".
export const DISPATCH_PROFILES = new Set(["default", "ops", "builder", "personal", "seocontent"]);

export function requestAssignee(request) {
  const raw = typeof request?.assignee === "string" ? request.assignee.trim().toLowerCase() : "";
  return DISPATCH_PROFILES.has(raw) ? raw : "default";
}
