/* Hermes profiles the /hermes composer can dispatch to. Each value is a real
   Hermes profile used as the kanban task assignee: /api/hermes/dispatch stores
   it on AgentRequest.assignee and hermes-bridge passes it straight to the
   kanban create call (runRequest → kanbanCreateTask({ assignee })). One
   composer + one request history replaces the old per-agent chat. */

import { AGENT_ROSTER } from "./agent-roster";

export const DEFAULT_DISPATCH_PROFILE = "default";

export interface DispatchTarget {
  profile: string;
  label: string;
}

export const DISPATCH_TARGETS: DispatchTarget[] = AGENT_ROSTER.map((agent) => ({
  profile: agent.profile,
  label: agent.profile === DEFAULT_DISPATCH_PROFILE ? `${agent.name} (default)` : agent.profile,
}));

const KNOWN = new Set(DISPATCH_TARGETS.map((t) => t.profile));

/** Unknown, empty, or non-string input falls back to the default profile, so a
 *  crafted request can never route work to an arbitrary assignee. */
export function normalizeDispatchProfile(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DISPATCH_PROFILE;
  const v = value.trim().toLowerCase();
  return KNOWN.has(v) ? v : DEFAULT_DISPATCH_PROFILE;
}

export function dispatchTargetLabel(profile: string | null | undefined): string {
  const p = normalizeDispatchProfile(profile);
  return DISPATCH_TARGETS.find((t) => t.profile === p)?.label ?? p;
}
